import type { BlobNotFound, BlobStoreFailed } from '@tironian/blobs';
import { defineKeys } from 'wellcrafted/query';
import { Err, type Result } from 'wellcrafted/result';
import type { DownloadError } from '#platform/download';
import type { TironianQueryRuntime } from '$lib/queries/client';
import { services } from '$lib/services';
import type { Recording } from '$lib/state/recordings.svelte';

export const downloadKeys = defineKeys({
	downloadRecording: ['download', 'downloadRecording'],
});

export function createDownloadQueries({
	defineMutation,
}: Pick<TironianQueryRuntime, 'defineMutation'>) {
	return {
		downloadRecording: defineMutation({
			mutationKey: downloadKeys.downloadRecording,
			mutationFn: async (
				recording: Recording,
			): Promise<
				Result<void, BlobNotFound | BlobStoreFailed | DownloadError>
			> => {
				const { data: audioBlob, error: getAudioBlobError } =
					await services.blobs.local.get(recording.audioBlobId);

				if (getAudioBlobError) return Err(getAudioBlobError);

				return services.download.downloadBlob({
					name: `tironian_recording_${recording.id}`,
					blob: audioBlob,
				});
			},
		}),
	};
}
