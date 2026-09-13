/**
 * The local transcription model administration Settings renders (ADR-0245).
 *
 * Tironian has exactly one **active** local transcription model per device.
 * The host owns it; this store is how Settings administers it: which model is
 * active, downloading and deleting model files, and when the host drops the
 * resident model. A transcription request never names a model, so this is the
 * only place in the product where a model is chosen.
 *
 * Three kinds of truth, deliberately kept apart:
 *
 *  - CATALOG, at rest: the models Rust offers, each carrying whether its file is
 *    already in the shared Hugging Face cache. Rust owns it; refreshed on first
 *    use, on window focus, and after every mutation.
 *  - TRANSFERS, in motion: downloads underway, with progress and a cancel flag.
 *    Transient, fed by the download progress callback; never in a catalog scan
 *    yet.
 *  - HOST SETTINGS, durable: the active model and the unload policy, owned by
 *    Rust and device-local, read back so this view reflects what the host will
 *    actually do rather than what it last asked for.
 *
 * Nothing here reports residency. Whether a model is loaded, warm, or evicted is
 * host-private; `downloaded` is disk presence and nothing more.
 *
 * Native-only. Off Tauri the commands do not exist and the model files would be
 * on another machine anyway, so the store stays inert and reports
 * `available: false` rather than throwing at import.
 */
import { SvelteMap } from 'svelte/reactivity';
import { tauri } from '#platform/tauri';
import { localRoute } from '$lib/state/local-route.svelte';
import type { ActiveModel, ModelInfo, UnloadPolicy } from '$lib/tauri/commands';

export type ModelTransferState =
	| { type: 'not-downloaded' }
	| { type: 'downloading'; progress: number; cancelling: boolean }
	| { type: 'ready' };

function createLocalModels() {
	// Bound once so the closures below cannot re-narrow a possibly-null seam.
	const host = tauri;

	// `null` until the first scan lands, so "loading" differs from "empty".
	let models = $state.raw<ModelInfo[] | null>(null);
	let active = $state.raw<ActiveModel | null>(null);
	let unloadPolicy = $state.raw<UnloadPolicy>('after_5_minutes');

	// Keyed by model id. The map IS the re-entry gate: a key present means a
	// transfer owns that model, cleared only when that same run settles, so a
	// cancel can never reopen the door for a second overlapping download over the
	// same file. `id` is unique per attempt, so Rust maps it to exactly one
	// transfer; `cancelling` gates late progress.
	const transfers = new SvelteMap<
		string,
		{ id: string; progress: number; cancelling: boolean }
	>();
	let attempts = 0;

	/** The last failure worth showing, cleared by the next successful action. */
	let error = $state.raw<string | null>(null);

	async function refresh() {
		if (!host) return;
		const [scanned, activeModel, policy] = await Promise.all([
			host.models.listModels(),
			host.models.getActiveModel(),
			host.models.getUnloadPolicy(),
		]);
		models = scanned;
		active = activeModel;
		unloadPolicy = policy;
	}

	/**
	 * Re-read everything a mutation can move. What the local route can do
	 * depends on the active model, so the readiness the record screen and the
	 * transcription settings show is refreshed with the catalog.
	 */
	async function settle() {
		await Promise.all([refresh(), localRoute.refresh()]);
	}

	/**
	 * Make `model` the one active local model. Every ordinary local
	 * transcription on this device runs on it from the next call onward.
	 */
	async function activate(model: ModelInfo) {
		if (!host) return;
		const { error: failure } = await host.models.setActiveModel(model.id);
		error = failure ? failure.message : null;
		await settle();
	}

	/**
	 * Download a model into the shared HF cache, skipping when it is already
	 * present. Reports whether the model ended up on disk. Never activates:
	 * downloading is acquiring a file, and choosing what runs is a separate act.
	 */
	async function download(model: ModelInfo): Promise<boolean> {
		if (!host || transfers.has(model.id)) return false;
		const id = `${model.id}#${++attempts}`;
		transfers.set(model.id, { id, progress: 0, cancelling: false });

		// Already downloaded? A fresh scan is the one truth; skip the transfer.
		await refresh();
		const alreadyInstalled = (models ?? []).find(
			(m) => m.id === model.id,
		)?.downloaded;
		// A cancel that arrived during the install check stops here.
		if (alreadyInstalled || transfers.get(model.id)?.cancelling) {
			transfers.delete(model.id);
			return Boolean(alreadyInstalled);
		}

		const { error: failure } = await host.models.downloadModel(
			model.id,
			id,
			({ bytesReceived, totalBytes }) => {
				// f64 fields arrive as `number | null` (specta guards non-finite
				// floats). Guard the total anyway.
				const received = bytesReceived ?? 0;
				const total = totalBytes && totalBytes > 0 ? totalBytes : 0;
				if (total <= 0) return;
				const progress = Math.min(100, Math.round((received / total) * 100));
				const transfer = transfers.get(model.id);
				if (transfer && !transfer.cancelling)
					transfers.set(model.id, { ...transfer, progress });
			},
		);
		const wasCancelled = transfers.get(model.id)?.cancelling ?? false;
		transfers.delete(model.id);
		// A requested cancel is the cause of the error: a clean stop, not a
		// failure worth reporting.
		error = failure && !wasCancelled ? failure.message : null;
		await settle();
		return failure === null;
	}

	// No read at import. The settings barrel reaches this module from screens
	// that never show the panel, so the view asks for the first scan when it
	// mounts rather than every importer paying three host calls.

	return {
		/** Whether this device can administer local models at all. */
		get available() {
			return host !== null;
		},
		/** The catalog scan. */
		get models() {
			return models ?? [];
		},
		/** Whether the first scan has landed. */
		get loaded() {
			return models !== null;
		},
		/** The active model, or `null` when nobody has chosen one. */
		get active() {
			return active;
		},
		/** When the host drops the resident model. */
		get unloadPolicy() {
			return unloadPolicy;
		},
		get error() {
			return error;
		},

		/** Where a model stands: a live transfer, else catalog download truth. */
		stateOf(model: ModelInfo): ModelTransferState {
			const transfer = transfers.get(model.id);
			if (transfer)
				return {
					type: 'downloading',
					progress: transfer.progress,
					cancelling: transfer.cancelling,
				};
			return model.downloaded ? { type: 'ready' } : { type: 'not-downloaded' };
		},

		/**
		 * Read the catalog and host settings. The view calls this when it mounts
		 * and on window focus, because the shared HF cache can change outside
		 * the app.
		 */
		refresh,

		activate,

		async setUnloadPolicy(policy: UnloadPolicy) {
			if (!host) return;
			const { error: failure } = await host.models.setUnloadPolicy(policy);
			error = failure ? failure.message : null;
			await refresh();
		},

		download,

		/**
		 * The first-run path: fetch a model and make it the active one, as a single
		 * labelled act. Two steps by two verbs, not an implicit consequence of
		 * downloading, because a second download must not silently reassign what
		 * every transcription on this machine runs on.
		 */
		async downloadAndActivate(model: ModelInfo) {
			if (await download(model)) await activate(model);
		},

		/**
		 * Request cancellation of an in-flight download. Marks it cancelling (the
		 * UI shows "Cancelling…") and aborts its transfer in Rust. A no-op when
		 * nothing is downloading.
		 */
		async cancel(model: ModelInfo) {
			const transfer = transfers.get(model.id);
			if (!host || !transfer) return;
			transfers.set(model.id, { ...transfer, cancelling: true });
			await host.models.cancelDownload(transfer.id);
		},

		/**
		 * Remove a downloaded model's file from the shared HF cache.
		 *
		 * One invoke, not two. Deleting the file and standing down the active
		 * choice are one host operation, so this cannot half-succeed into a state
		 * where the file is gone but the host still points at it. The host clears
		 * rather than promoting another installed model: there is no substitution,
		 * so the next transcription fails with an actionable error until the user
		 * picks again.
		 */
		async remove(model: ModelInfo) {
			if (!host) return;
			const { error: failure } = await host.models.deleteModel(model.id);
			error = failure ? failure.message : null;
			// The host may have removed the file before failing to clear the
			// choice, so re-read rather than assuming nothing changed.
			await settle();
		},
	};
}

/** The one shared model-administration store. */
export const localModels = createLocalModels();
