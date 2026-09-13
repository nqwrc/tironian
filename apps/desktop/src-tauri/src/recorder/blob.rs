//! Native recorder staging and publication into Tironian's canonical local
//! blob layout.
//!
//! Rust mints the opaque `BlobId` when a recording starts, writes its audio and
//! metadata into a private staging directory, fsyncs both files, and atomically
//! renames the directory to `<appDataDir>/blobs/<BlobId>`. Raw PCM never crosses
//! the IPC boundary; an application holds only the id.
//!
//! The id exists before its blob does. `start` returns it, `stop` publishes the
//! blob under it, and `cancel` burns it without a blob ever appearing. That is
//! why this module mints and validates in the same place: the shape is one
//! contract shared with `packages/blobs`, and the two mints must agree.
//!
//! # Staging is not a blob
//!
//! A [`StagedBlob`] is a directory nothing outside this module can name. It is
//! written to while a recording runs and becomes a blob in exactly one step, the
//! rename in [`StagedBlob::publish`]. Until that rename there is no blob at the
//! id, which is what keeps ADR-0173's write-once slot from ever observing a
//! partial byte stream: incomplete capture has temporary staging state and no
//! permanent blob identity.

// `File` is read-only-open territory: the `cfg(unix)` `sync_directory` below and
// the tests' `File::create`. Windows non-test builds compile neither, so the
// import is gated to match or it warns as unused there.
#[cfg(any(unix, test))]
use std::fs::File;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use log::{info, warn};
use serde::Serialize;
use tauri::AppHandle;

use crate::audio::decode_to_pcm16k_mono;
use crate::recorder::error::RecorderError;

const BLOB_CONTENT_TYPE: &str = "audio/wav";
const BLOBS_DIRECTORY: &str = "blobs";
const STAGING_DIRECTORY: &str = ".staging";
const RUST_STAGING_DIRECTORY: &str = "rust";
const DATA_FILE: &str = "data";
const METADATA_FILE: &str = "metadata.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlobMetadata {
    content_type: &'static str,
    /// Serializes as a plain JSON number, so the 32-bit width here is only the
    /// RIFF bound this writer already enforces, not a change to the on-disk
    /// metadata shape other blob writers produce.
    size: u32,
}

/// `blob_` plus 21 characters of this alphabet, matching `generateBlobId` in
/// `packages/blobs/src/blob-id.ts`. Every character is safe as a filesystem
/// name, an S3 key segment, and a URL path segment, so the id is used verbatim
/// as a storage key.
const BLOB_ID_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
const BLOB_ID_BODY_LEN: usize = 21;

/// Mint a fresh blob id for a recording that is about to start.
///
/// This is the second mint of the one BlobId shape; `generateBlobId` in
/// `packages/blobs` is the other. They must produce the same shape, which
/// `validate_blob_id` and the round-trip test below pin from this side.
///
/// Rejection sampling against a power-of-two mask rather than `byte % 36`,
/// which would bias the first four letters. `getrandom` is the OS CSPRNG, the
/// same source nanoid uses.
pub(crate) fn mint_blob_id() -> Result<String, RecorderError> {
    // 36 values need 6 bits; a 63 mask keeps the draw uniform and rejects the
    // 28 of 64 patterns that fall outside the alphabet.
    const MASK: u8 = 63;
    let mut id = String::with_capacity("blob_".len() + BLOB_ID_BODY_LEN);
    id.push_str("blob_");
    let mut buffer = [0u8; 32];
    while id.len() < "blob_".len() + BLOB_ID_BODY_LEN {
        getrandom::fill(&mut buffer)
            .map_err(|error| RecorderError::failed(format!("draw blob id bytes: {error}")))?;
        for byte in buffer {
            let index = (byte & MASK) as usize;
            if index < BLOB_ID_ALPHABET.len() {
                id.push(BLOB_ID_ALPHABET[index] as char);
                if id.len() == "blob_".len() + BLOB_ID_BODY_LEN {
                    break;
                }
            }
        }
    }
    Ok(id)
}

fn validate_blob_id(id: &str) -> Result<(), RecorderError> {
    let body = id
        .strip_prefix("blob_")
        .ok_or_else(|| RecorderError::failed("blob id must start with 'blob_'"))?;
    if body.len() != BLOB_ID_BODY_LEN
        || !body
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    {
        return Err(RecorderError::failed("blob id has an invalid shape"));
    }
    Ok(())
}

/// `<root>/blobs`, resolved natively because a recording can start before this
/// process has anything to be told (`crate::app_data`). The sidecar names the
/// same directory from `tironianDataRoot()`, and the two are pinned equal by
/// `app_data`'s tests rather than by both reading the same constant.
fn blobs_directory(app: &AppHandle) -> Result<PathBuf, RecorderError> {
    let root = crate::app_data::tironian_data_root(app).map_err(|error| {
        RecorderError::failed(format!("resolve the Tironian data root: {error}"))
    })?;
    Ok(root.join(BLOBS_DIRECTORY))
}

fn blob_data_path(app: &AppHandle, id: &str) -> Result<PathBuf, RecorderError> {
    validate_blob_id(id)?;
    Ok(blobs_directory(app)?.join(id).join(DATA_FILE))
}

/// One blob's bytes, being written, before the blob exists.
///
/// Created when a recording starts and resolved exactly once: [`Self::publish`]
/// makes it the blob at its id, [`Self::discard`] deletes it and the id is never
/// used again. Nothing else can name the directory in between.
#[derive(Debug)]
pub struct StagedBlob {
    id: String,
    /// `<appDataDir>/blobs`, kept so publication can fsync it after the rename.
    root: PathBuf,
    staged_directory: PathBuf,
    final_directory: PathBuf,
}

impl StagedBlob {
    /// Open a staging directory for a recording that is about to start.
    ///
    /// The id is validated and the destination checked here, at the start of the
    /// recording, so a caller learns its blob cannot be written before it spends
    /// an hour capturing audio for it.
    pub fn create(app: &AppHandle, id: &str) -> Result<Self, RecorderError> {
        Self::stage(blobs_directory(app)?, id)
    }

    /// Open a staging directory under a given blobs root.
    ///
    /// The root is a parameter rather than resolved here because "where the
    /// store lives" is the app's fact while "how a blob is staged and published"
    /// is this module's. [`Self::create`] is the one production caller and
    /// supplies the app's own root.
    pub(crate) fn stage(root: PathBuf, id: &str) -> Result<Self, RecorderError> {
        validate_blob_id(id)?;
        // Each writer owns a distinct staging subtree. Bun writes under
        // `.staging/bun`; native capture writes here, which is what lets the
        // startup sweep judge every entry by this module's naming rule without
        // ever mistaking another runtime's active publication for its own
        // debris. The pid in the name is what the sweep judges by.
        let staging_root = root.join(STAGING_DIRECTORY).join(RUST_STAGING_DIRECTORY);
        std::fs::create_dir_all(&staging_root).map_err(|error| {
            RecorderError::failed(format!(
                "create blob staging directory {}: {error}",
                staging_root.display()
            ))
        })?;

        let final_directory = root.join(id);
        if final_directory.exists() {
            return Err(RecorderError::failed(format!("blob '{id}' already exists")));
        }

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| RecorderError::failed(format!("read system clock: {error}")))?
            .as_nanos();
        let staged_directory = staging_root.join(format!("{id}-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&staged_directory).map_err(|error| {
            RecorderError::failed(format!(
                "create staged blob directory {}: {error}",
                staged_directory.display()
            ))
        })?;

        Ok(Self {
            id: id.to_string(),
            root,
            staged_directory,
            final_directory,
        })
    }

    /// Where the bytes go. The caller owns this file for the recording's whole
    /// life and must have flushed everything it intends to keep before
    /// publishing; `publish` syncs it but cannot invent what was never written.
    pub fn data_path(&self) -> PathBuf {
        self.staged_directory.join(DATA_FILE)
    }

    /// Make these bytes the blob at this id, returning the published file's
    /// exact length.
    ///
    /// The durability ladder, in order, because each rung depends on the one
    /// below it: sync the data, write and sync the metadata, sync the staging
    /// directory so both files' names are durable, rename (the atomic step that
    /// makes the blob exist), then sync the blobs root so the new name is
    /// durable too. Nothing here relies on `Drop`, which cannot report a
    /// failure.
    ///
    /// `u32` rather than `u64` because the data is a RIFF WAV and RIFF states
    /// its own size in 32 bits, so the writer already refuses anything larger.
    pub fn publish(self) -> Result<u32, RecorderError> {
        let mut published = false;
        let result = (|| {
            let data_path = self.data_path();
            sync_file(&data_path)?;
            let size = std::fs::metadata(&data_path)
                .map_err(|error| {
                    RecorderError::failed(format!(
                        "stat staged blob {}: {error}",
                        data_path.display()
                    ))
                })?
                .len();
            let size = u32::try_from(size)
                .map_err(|_| RecorderError::failed("published blob exceeds the RIFF size limit"))?;
            let metadata_path = self.staged_directory.join(METADATA_FILE);
            let metadata = serde_json::to_vec(&BlobMetadata {
                content_type: BLOB_CONTENT_TYPE,
                size,
            })
            .map_err(|error| RecorderError::failed(format!("serialize blob metadata: {error}")))?;
            std::fs::write(&metadata_path, metadata).map_err(|error| {
                RecorderError::failed(format!(
                    "write blob metadata {}: {error}",
                    metadata_path.display()
                ))
            })?;
            sync_file(&metadata_path)?;
            sync_directory(&self.staged_directory)?;
            std::fs::rename(&self.staged_directory, &self.final_directory).map_err(|error| {
                RecorderError::failed(format!(
                    "publish blob {}: {error}",
                    self.final_directory.display()
                ))
            })?;
            published = true;
            sync_directory(&self.root)?;
            Ok(size)
        })();

        match result {
            Ok(size) => Ok(size),
            Err(error) => {
                let cleanup_target = if published {
                    &self.final_directory
                } else {
                    &self.staged_directory
                };
                if let Err(cleanup_error) = std::fs::remove_dir_all(cleanup_target) {
                    return Err(RecorderError::failed(format!(
                        "{error}; cleanup blob {}: {cleanup_error}",
                        cleanup_target.display()
                    )));
                }
                if published {
                    let _ = sync_directory(&self.root);
                }
                Err(error)
            }
        }
    }

    /// Delete these bytes. The id is burnt: no blob will ever exist under it.
    ///
    /// Failure is logged rather than returned, because there is nothing a caller
    /// could do with it that the startup sweep does not already do.
    pub fn discard(self) {
        if let Err(error) = std::fs::remove_dir_all(&self.staged_directory) {
            warn!(
                "Failed to discard staged blob {} at {}: {error}",
                self.id,
                self.staged_directory.display()
            );
        }
    }
}

/// Delete every staged native capture left behind by a previous launch.
///
/// A recording that was still capturing when the host process died left a
/// partial WAV here. It is not a blob and never will be one: no id was
/// published, no row references it, and nothing can say whether it holds a whole
/// sentence or half a word. So this deletes, and only deletes. It does not
/// promote a partial file to a blob, repair it, announce it, or write a manifest
/// naming it, because any of those would make a recording surviving a host crash
/// a promise the host would then have to keep.
///
/// Every staged directory is deleted only once the process that staged it has
/// exited, judged by the pid [`StagedBlob::stage`] embeds in its name. Being
/// single-instance does not make this process the only writer.
/// `tauri_plugin_single_instance` locks per bundle identifier, and the dev build
/// (`app.tironian.dev`) and the installed app (`app.tironian`) are two
/// identifiers over one data root (`crate::app_data` keeps the root shared on
/// purpose). Sweeping the whole subtree, as this once did, let a dev launch
/// delete a production recording's audio while it was being captured. The same
/// check covers two hosts pointed at one `TIRONIAN_DATA_DIR`, and the macOS
/// single-instance handshake race.
///
/// A name this module could not have produced has no owner to wait for, so it
/// is deleted: only this module writes here, and keeping it would leak it
/// forever. The known limit is pid reuse: a dead host's pid taken by an
/// unrelated live process keeps that directory until a later launch finds the
/// pid free. That costs disk, never audio, which is the right way round.
pub fn delete_stale_staging(app: &AppHandle) {
    let Ok(root) = blobs_directory(app) else {
        return;
    };
    delete_staging_root(&root, process_is_alive);
}

/// Delete every entry of a blobs root's native staging subtree whose owning
/// process `owner_is_alive` reports gone, then the subtree itself if that left
/// it empty. The probe is a parameter so a test can play a host that died.
pub(crate) fn delete_staging_root(root: &Path, owner_is_alive: impl Fn(u32) -> bool) {
    let staging_root = root.join(STAGING_DIRECTORY).join(RUST_STAGING_DIRECTORY);
    let entries = match std::fs::read_dir(&staging_root) {
        Ok(entries) => entries,
        // Nothing to sweep is the ordinary case: a clean exit leaves none.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            warn!(
                "Failed to read recorder staging at {}: {error}",
                staging_root.display()
            );
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let owner = entry.file_name().to_str().and_then(staged_owner_pid);
        if let Some(pid) = owner {
            if owner_is_alive(pid) {
                info!(
                    "Kept recorder staging {} owned by live process {pid}",
                    path.display()
                );
                continue;
            }
        }
        let removed = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        match removed {
            Ok(()) => info!("Deleted stale recorder staging at {}", path.display()),
            Err(error) => warn!(
                "Failed to delete stale recorder staging at {}: {error}",
                path.display()
            ),
        }
    }

    // Fails while a live entry remains, which is exactly when it must stay.
    let _ = std::fs::remove_dir(&staging_root);
}

/// The pid in a `{blob id}-{pid}-{nonce}` staging name, or `None` for a name
/// [`StagedBlob::stage`] could not have produced. Parsed from the right so the
/// rule does not depend on the blob id's alphabet excluding `-`.
fn staged_owner_pid(name: &str) -> Option<u32> {
    let mut parts = name.rsplitn(3, '-');
    let nonce = parts.next()?;
    let pid = parts.next()?;
    let id = parts.next()?;
    validate_blob_id(id).ok()?;
    nonce.parse::<u128>().ok()?;
    pid.parse::<u32>().ok().filter(|pid| *pid != 0)
}

/// Whether a process with this pid is running. Every answer the OS does not
/// make certain counts as alive: a wrong "alive" leaks a directory until the
/// next launch, a wrong "dead" deletes a recording in flight.
#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    use windows::core::HRESULT;
    use windows::Win32::Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, STILL_ACTIVE};
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    // SAFETY: a plain query-rights open; the handle is closed below.
    let handle = match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        Ok(handle) => handle,
        // Windows answers an unknown pid with ERROR_INVALID_PARAMETER. Any other
        // refusal, such as access denied, names a process that exists.
        Err(error) => return error.code() != HRESULT::from_win32(ERROR_INVALID_PARAMETER.0),
    };
    let mut exit_code = 0u32;
    // SAFETY: `handle` is open with query rights and `exit_code` outlives the call.
    let queried = unsafe { GetExitCodeProcess(handle, &mut exit_code) };
    // SAFETY: `handle` came from `OpenProcess` and is not used after this.
    let _ = unsafe { CloseHandle(handle) };
    match queried {
        // An exited process whose handle someone still holds reports its exit
        // code here, not STILL_ACTIVE, so it correctly counts as gone.
        Ok(()) => exit_code == STILL_ACTIVE.0 as u32,
        Err(_) => true,
    }
}

/// Whether a process with this pid is running. Every answer the OS does not
/// make certain counts as alive: a wrong "alive" leaks a directory until the
/// next launch, a wrong "dead" deletes a recording in flight.
#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    // A pid no `pid_t` can hold names no process.
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 delivers nothing; it only checks existence and permission.
    if unsafe { libc::kill(pid, 0) } == 0 {
        return true;
    }
    // EPERM is a live process this user cannot signal; only ESRCH means gone.
    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

/// No probe on this platform, so nothing is ever proven dead.
#[cfg(not(any(windows, unix)))]
fn process_is_alive(_pid: u32) -> bool {
    true
}

/// Decode one canonical local blob to the PCM shape local transcription uses.
pub fn read_blob_samples(app: &AppHandle, id: &str) -> Result<Vec<f32>, RecorderError> {
    let path = blob_data_path(app, id)?;
    let bytes = std::fs::read(&path)
        .map_err(|error| RecorderError::failed(format!("read blob {}: {error}", path.display())))?;
    decode_to_pcm16k_mono(&bytes)
        .map_err(|error| RecorderError::failed(format!("decode blob {}: {error}", path.display())))
}

/// Force a file's contents and metadata to disk, by path.
///
/// By path rather than by handle because the writer that produced the file has
/// already been consumed by the time it is published: `hound`'s `finalize` takes
/// the writer by value. Opening read-only is enough, since `fsync` acts on the
/// file the descriptor names rather than on the descriptor's access mode.
/// Open for *writing* rather than reading, even though nothing is written here.
/// `sync_all` is `FlushFileBuffers` on Windows, which the API documents as
/// requiring a handle with write access: a read-only handle fails it with
/// `ERROR_ACCESS_DENIED` (os error 5), which took down every native recording
/// on Windows at the first rung of `publish`'s durability ladder. Unix `fsync`
/// is happy either way, so one write-opened handle serves both platforms and
/// there is no `cfg` to keep in step (unlike `sync_directory` below, where the
/// two platforms genuinely differ).
fn sync_file(path: &Path) -> Result<(), RecorderError> {
    OpenOptions::new()
        .write(true)
        .open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| RecorderError::failed(format!("sync {}: {error}", path.display())))
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), RecorderError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| {
            RecorderError::failed(format!("sync blob directory {}: {error}", path.display()))
        })
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), RecorderError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const ID: &str = "blob_aaaaaaaaaaaaaaaaaaaaa";

    /// Stage `bytes` under `id` and publish them, returning the published size.
    fn publish_bytes(root: &Path, id: &str, bytes: &[u8]) -> Result<u32, RecorderError> {
        let staged = StagedBlob::stage(root.to_path_buf(), id)?;
        let mut file = File::create(staged.data_path()).expect("create the staged data file");
        file.write_all(bytes).expect("write the staged data file");
        drop(file);
        staged.publish()
    }

    /// A blob's metadata must describe the bytes actually published, because it
    /// is what every reader trusts instead of stat-ing the file.
    #[test]
    fn publishing_writes_the_bytes_and_metadata_that_describe_them() {
        let root = tempfile::tempdir().expect("a blobs root");
        let bytes = b"not really a wav, but exactly this many bytes";

        let size = publish_bytes(root.path(), ID, bytes).expect("publish");
        assert_eq!(size as usize, bytes.len());

        assert_eq!(
            std::fs::read(root.path().join(ID).join(DATA_FILE)).expect("read data"),
            bytes
        );
        let metadata =
            std::fs::read_to_string(root.path().join(ID).join(METADATA_FILE)).expect("read meta");
        assert_eq!(
            metadata,
            format!(r#"{{"contentType":"audio/wav","size":{}}}"#, bytes.len())
        );
    }

    /// ADR-0173's write-once slot, enforced at the one place that could break
    /// it: a second recording can never overwrite a published blob's bytes, and
    /// the refusal comes at `start` rather than after an hour of capture.
    #[test]
    fn a_published_blob_is_never_restaged_over() {
        let root = tempfile::tempdir().expect("a blobs root");
        publish_bytes(root.path(), ID, b"the first bytes").expect("publish");

        let error = StagedBlob::stage(root.path().to_path_buf(), ID)
            .expect_err("staging over a published blob must be refused");
        assert!(
            error.to_string().contains("already exists"),
            "unexpected refusal: {error}"
        );
        assert_eq!(
            std::fs::read(root.path().join(ID).join(DATA_FILE)).expect("read data"),
            b"the first bytes"
        );
    }

    /// A discarded recording leaves nothing: no blob, and no staging for the
    /// next launch's sweep to find.
    #[test]
    fn discarding_leaves_neither_a_blob_nor_staging() {
        let root = tempfile::tempdir().expect("a blobs root");
        let staged = StagedBlob::stage(root.path().to_path_buf(), ID).expect("stage");
        File::create(staged.data_path()).expect("create the staged data file");
        let staged_directory = staged.staged_directory.clone();

        staged.discard();

        assert!(!staged_directory.exists());
        assert!(!root.path().join(ID).exists());
    }

    /// The pid of a process that has already exited, obtained by running one
    /// rather than by guessing a number nothing is using. The child is returned
    /// too: on Windows its handle keeps the pid from being reused until the
    /// caller drops it.
    fn exited_process() -> (std::process::Child, u32) {
        let mut child = if cfg!(windows) {
            std::process::Command::new("cmd")
                .args(["/C", "exit"])
                .spawn()
        } else {
            std::process::Command::new("true").spawn()
        }
        .expect("spawn a process that exits at once");
        child.wait().expect("wait for the process to exit");
        let pid = child.id();
        (child, pid)
    }

    /// The sweep's contract with the OS probe, pinned against real processes:
    /// this one is alive and one that has exited is not.
    #[test]
    fn the_liveness_probe_tells_a_live_process_from_an_exited_one() {
        assert!(process_is_alive(std::process::id()));
        let (_child, pid) = exited_process();
        assert!(!process_is_alive(pid));
    }

    /// Dev and production are two single-instance applications over one data
    /// root, so the sweeping process is not the only possible writer: a staged
    /// capture whose process is alive belongs to a recording in flight and
    /// survives, while one whose process has exited is debris and goes.
    #[test]
    fn the_sweep_keeps_a_live_process_staging_and_deletes_a_dead_one() {
        let root = tempfile::tempdir().expect("a blobs root");
        let live = StagedBlob::stage(root.path().to_path_buf(), ID).expect("stage");
        File::create(live.data_path()).expect("create the live data file");

        let (_child, dead_pid) = exited_process();
        let staging_root = root
            .path()
            .join(STAGING_DIRECTORY)
            .join(RUST_STAGING_DIRECTORY);
        let dead = staging_root.join(format!("blob_bbbbbbbbbbbbbbbbbbbbb-{dead_pid}-1"));
        std::fs::create_dir(&dead).expect("stage a dead process's capture");
        File::create(dead.join(DATA_FILE)).expect("create the dead data file");

        delete_staging_root(root.path(), process_is_alive);

        assert!(
            live.data_path().exists(),
            "a recording in flight must keep its staged audio"
        );
        assert!(!dead.exists(), "an exited process's capture is debris");
        live.publish()
            .expect("the surviving capture still publishes");
    }

    /// Only this module writes `.staging/rust`, so a name it could not have
    /// produced has no owner to wait for. Keeping it would leak it forever.
    #[test]
    fn the_sweep_deletes_what_this_module_could_not_have_named() {
        let root = tempfile::tempdir().expect("a blobs root");
        let staging_root = root
            .path()
            .join(STAGING_DIRECTORY)
            .join(RUST_STAGING_DIRECTORY);
        std::fs::create_dir_all(&staging_root).expect("create the staging root");
        let own_pid = std::process::id();
        let malformed = [
            format!("not-a-blob-{own_pid}-1"),
            format!("{ID}-0-1"),
            format!("{ID}-{own_pid}"),
            format!("{ID}-{own_pid}-not-a-nonce"),
        ];
        for name in &malformed {
            std::fs::create_dir(staging_root.join(name)).expect("create a malformed entry");
        }
        File::create(staging_root.join("stray-file")).expect("create a stray file");

        delete_staging_root(root.path(), |_| true);

        assert!(
            !staging_root.exists(),
            "every malformed entry goes, and the emptied staging root with them"
        );
    }

    #[test]
    fn staged_names_parse_back_to_their_owner() {
        assert_eq!(staged_owner_pid(&format!("{ID}-4242-17")), Some(4242));
        assert_eq!(staged_owner_pid(&format!("{ID}-0-17")), None);
        assert_eq!(staged_owner_pid(&format!("{ID}-4242")), None);
        assert_eq!(staged_owner_pid("blob_short-4242-17"), None);
    }

    #[test]
    fn blob_id_validation_accepts_only_the_public_shape() {
        assert!(validate_blob_id("blob_abcdefghijklmnopqrstu").is_ok());
        assert!(validate_blob_id("abcdefghijklmnopqrstu").is_err());
        assert!(validate_blob_id("blob_ABCDEFGHIJKLMNOPQRSTU").is_err());
        assert!(validate_blob_id("blob_abcdefghijklmnopqrs/u").is_err());
    }

    /// The mint/parse round trip, matching `blob-id.test.ts` on the other side
    /// of the same contract. If either mint drifts from the shared shape, one
    /// of the two round-trip tests fails rather than a blob path failing in
    /// production.
    #[test]
    fn minted_ids_round_trip_through_validation() {
        for _ in 0..1_000 {
            let id = mint_blob_id().expect("mint a blob id");
            assert_eq!(id.len(), "blob_".len() + BLOB_ID_BODY_LEN);
            validate_blob_id(&id).expect("a minted id must parse");
        }
    }

    /// Distinctness, and coverage of the whole alphabet. Rejection sampling is
    /// easy to get subtly wrong in a way that silently narrows the alphabet, so
    /// this asserts every character is reachable rather than only that ids
    /// differ.
    #[test]
    fn minted_ids_are_distinct_and_span_the_alphabet() {
        let mut seen_ids = std::collections::HashSet::new();
        let mut seen_chars = std::collections::HashSet::new();
        for _ in 0..2_000 {
            let id = mint_blob_id().expect("mint a blob id");
            seen_chars.extend(id["blob_".len()..].bytes());
            assert!(seen_ids.insert(id), "minted a duplicate blob id");
        }
        assert_eq!(
            seen_chars.len(),
            BLOB_ID_ALPHABET.len(),
            "some alphabet characters are unreachable"
        );
    }
}
