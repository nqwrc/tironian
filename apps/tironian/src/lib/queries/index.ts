import type { TironianApp } from '$lib/app/app';
import { createAudioQueries } from './audio';
import type { TironianQueryRuntime } from './client';
import { createDownloadQueries } from './download';
import { createTranscriptionQueries } from './transcription';

/**
 * Cross-platform query namespace, bound to one ready app. Built once by
 * the UI session and read from context.
 */
export function createTironianQueries(
	app: TironianApp,
	runtime: TironianQueryRuntime,
) {
	return {
		audio: createAudioQueries(app, runtime),
		download: createDownloadQueries(runtime),
		transcription: createTranscriptionQueries(app, runtime),
	};
}

export type TironianQueries = ReturnType<typeof createTironianQueries>;
