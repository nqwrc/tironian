import type { Accessor } from '@tanstack/svelte-query';
import { defineKeys } from 'wellcrafted/query';
import type { TironianApp } from '$lib/app/app';
import type { TironianQueryRuntime } from '$lib/queries/client';
import type { Recording } from '$lib/state/recordings.svelte';

export const audioKeys = defineKeys({
	availability: (id: Recording['id'], audioBlobId: Recording['audioBlobId']) =>
		['audio', 'availability', id, audioBlobId] as const,
});

export function createAudioQueries(
	app: TironianApp,
	{ defineQuery }: Pick<TironianQueryRuntime, 'defineQuery'>,
) {
	return {
		availability: (
			recording: Accessor<Pick<Recording, 'id' | 'audioBlobId'>>,
		) => {
			const current = recording();
			return defineQuery({
				queryKey: audioKeys.availability(current.id, current.audioBlobId),
				queryFn: () => app.recordings.audioAvailability(recording().id),
			});
		},
	};
}
