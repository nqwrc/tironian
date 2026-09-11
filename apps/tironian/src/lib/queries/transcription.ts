import { defineKeys } from 'wellcrafted/query';
import { Ok, partitionResults } from 'wellcrafted/result';
import type { TironianApp } from '$lib/app/app';
import { transcribeAndPersist } from '$lib/operations/transcribe';
import type { TironianQueryRuntime } from '$lib/queries/client';
import type { Recording } from '$lib/state/recordings.svelte';

export const transcriptionKeys = defineKeys({
	isTranscribing: ['transcription', 'isTranscribing'],
});

export function createTranscriptionQueries(
	app: TironianApp,
	{
		defineMutation,
		queryClient,
	}: Pick<TironianQueryRuntime, 'defineMutation' | 'queryClient'>,
) {
	return {
		isCurrentlyTranscribing() {
			return (
				queryClient.isMutating({
					mutationKey: transcriptionKeys.isTranscribing,
				}) > 0
			);
		},
		// Both retries take the generous deadline. A retry runs outside the
		// pipeline's run queue, so a hung one holds nothing but its own row, and
		// `transcribeRecordings` starts every clock at once while the on-device
		// route serializes the work in Rust: the last of ten selected recordings
		// waits for the other nine inside its own ceiling. A tight bound here
		// would expire on work that was going to succeed.
		transcribeRecording: defineMutation({
			mutationKey: transcriptionKeys.isTranscribing,
			mutationFn: (recording: Recording) =>
				transcribeAndPersist(app, recording.id, recording.audioBlobId, {
					deadline: 'batch',
				}),
		}),

		transcribeRecordings: defineMutation({
			mutationKey: transcriptionKeys.isTranscribing,
			mutationFn: async (recordings: Recording[]) => {
				const results = await Promise.all(
					recordings.map((recording) =>
						transcribeAndPersist(app, recording.id, recording.audioBlobId, {
							deadline: 'batch',
						}),
					),
				);
				return Ok(partitionResults(results));
			},
		}),
	};
}
