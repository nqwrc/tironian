import { defineErrors, type InferErrors } from 'wellcrafted/error';
import { handsFreePushToTalk } from '../operations/hands-free-instance';
import { watchManualRecordingEnded } from '../operations/recording';
import { m } from '../paraglide/messages';
import { createTironianQueries } from '../queries';
import { createTironianQueryRuntime } from '../queries/client';
import { createRecordings } from '../state/recordings.svelte';
import { createSettingsView } from '../state/settings.svelte';
import {
	openTironianApp,
	type TironianApp,
	type TironianAppDependencies,
} from './app';

function createTironianUiSession(core: TironianApp) {
	const app: TironianApp = {
		...core,
		settings: createSettingsView(core.settings),
		recordings: createRecordings(core),
		recipes: core.recipes,
	};
	const queryRuntime = createTironianQueryRuntime();
	const queries = createTironianQueries(app, queryRuntime);
	// A capture can end without anyone asking, including while no screen is
	// mounted, so the reaction belongs to the session rather than to a component.
	watchManualRecordingEnded(app);
	let disposal: Promise<void> | undefined;

	return {
		app,
		queries,
		queryClient: queryRuntime.queryClient,
		[Symbol.asyncDispose]() {
			disposal ??= (async () => {
				try {
					// Goes through the hands-free wrapper, not `pushToTalk` directly, so a
					// torn-down session cannot leave the next one starting locked.
					await handsFreePushToTalk.dispose(app);
				} finally {
					queryRuntime.queryClient.clear();
					await core[Symbol.asyncDispose]();
				}
			})();
			return disposal;
		},
	};
}

export type TironianUiSession = ReturnType<typeof createTironianUiSession>;

export const TironianUiSessionError = defineErrors({
	TeardownFailed: ({ cause }: { cause: unknown }) => ({
		message: m.ui_session_teardown_failed(),
		cause,
	}),
});
export type TironianUiSessionError = InferErrors<typeof TironianUiSessionError>;

export async function openTironianUiSession(
	dependencies: TironianAppDependencies,
	signal: AbortSignal,
): Promise<TironianUiSession> {
	const core = await openTironianApp(dependencies, { signal });
	try {
		return createTironianUiSession(core);
	} catch (cause) {
		await core[Symbol.asyncDispose]();
		throw cause;
	}
}
