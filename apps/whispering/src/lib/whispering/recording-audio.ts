import type { BlobStore, BlobStoreFailed } from '@epicenter/blobs';
import { defineErrors, type InferErrors } from 'wellcrafted/error';
import { Err, Ok, type Result } from 'wellcrafted/result';
import { m } from '../paraglide/messages';
import type { Recording } from './recording.js';

/** The composed blob capability an environment supplies to the app. */
export type WhisperingBlobs = {
	local: BlobStore;
};

export type RecordingAudioAvailability = 'available' | 'unavailable';

export const RecordingAudioError = defineErrors({
	RecordingNotFound: ({ recordingId }: { recordingId: Recording['id'] }) => ({
		message: m.recording_audio_this_recording_no_longer_exists(),
		recordingId,
	}),
});
export type RecordingAudioError = InferErrors<typeof RecordingAudioError>;

/** The per-recording blob state every audio workflow operates on. */
type AudioState = Pick<Recording, 'id' | 'audioBlobId'>;

/** The app policy over canonical local bytes. */
export function createRecordingAudio({ blobs }: { blobs: WhisperingBlobs }) {
	return {
		/** Derive storage availability from local bytes alone. */
		async availability(
			recording: AudioState,
		): Promise<Result<RecordingAudioAvailability, BlobStoreFailed>> {
			const { error } = await blobs.local.stat(recording.audioBlobId);
			if (error === null) return Ok('available');
			if (error.name === 'BlobNotFound') return Ok('unavailable');
			return Err(error);
		},
	};
}
