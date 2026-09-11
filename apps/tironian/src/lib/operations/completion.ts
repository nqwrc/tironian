import { CompleteError, complete, resolveConnection } from '@tironian/client';
import type { Result } from 'wellcrafted/result';
import { customFetch } from '#platform/http';
import type { TironianApp } from '$lib/app/app';
import {
	type CompletionState,
	resolveCompletionStateFromConfig,
} from '$lib/operations/completion-target';
import { deviceConfig } from '$lib/state/device-config.svelte';

/**
 * Resolve the single global completion state: what to call (`target`), whether
 * Polish can run (`canRun`), and whether transcript text stays on this device
 * (`textStaysOnDevice`). All three are derived together from the global
 * `completion.*` setting and deviceConfig, read at use (ADR 0012) so nothing goes
 * stale. `target` is null when there is no base URL to talk to (Custom with no
 * endpoint configured), the one genuinely un-runnable state.
 */
export function resolveCompletionState(app: TironianApp): CompletionState {
	return resolveCompletionStateFromConfig({
		provider: app.settings.get('completionProvider'),
		getDeviceConfig: deviceConfig.get,
	});
}

/**
 * Run one completion against the single global AI default. Both the Polish pass
 * and every Recipe share this one call path, so provider/model/key resolution
 * lives here once. Every provider speaks the OpenAI completion wire (Anthropic
 * and Google through their OpenAI-compatibility endpoints, ADR-0060), so there is
 * no per-provider client and no wire-vs-bespoke branch: resolve a connection from
 * the `INFERENCE` table and hand it to the shared `complete()`. Provider and model
 * come from `completion.*` in settings, the key and endpoint from deviceConfig,
 * all read at use (ADR 0012) so nothing goes stale; pasted strings are trimmed.
 *
 * `signal` aborts the in-flight request (the Polish HUD's "ship raw" control).
 */
export function completeWithGlobalDefault(
	app: TironianApp,
	{
		systemPrompt,
		userPrompt,
		signal,
	}: {
		systemPrompt: string;
		userPrompt: string;
		signal?: AbortSignal;
	},
): Promise<Result<string, CompleteError>> {
	const { target } = resolveCompletionState(app);
	if (!target) {
		const provider = app.settings.get('completionProvider');
		return Promise.resolve(
			CompleteError.TransportFailed({
				cause: new Error(
					`No base URL set for the ${provider} completion provider. Add an endpoint in settings.`,
				),
			}),
		);
	}
	return completeWithDeadline(app, {
		connection: resolveConnection(
			{ baseUrl: target.baseUrl, apiKey: target.apiKey },
			customFetch,
		),
		systemPrompt,
		userPrompt,
		signal,
	});
}

/**
 * How long one completion may take before the caller stops waiting for it.
 *
 * Both AI passes are non-streaming awaits behind the pill's "Flowing…" HUD, and
 * a per-app rule with a recipe runs two of them, so an unbounded call is an
 * unbounded wait with the transcript held hostage behind it. Since pipeline
 * runs are serialized, it would also hold every later utterance.
 *
 * Generous on purpose: this is a ceiling for a call that is never coming back,
 * not a latency budget. A polish pass over even a long dictation answers in
 * seconds.
 */
export const COMPLETION_TIMEOUT_MS = 30_000;

/**
 * The failure a caller sees when the deadline expires.
 *
 * Split out so the copy can be asserted without waiting the deadline out, the
 * same division `decideSecureFieldGuard` makes: the decision is pure and
 * tested, the timing stays in the impure caller.
 *
 * Owning the copy matters. Surfacing whatever an aborted fetch rejected with
 * reads as a transport error and names no duration, so the person is told
 * something failed but not that waiting longer would not have helped.
 */
export function completionTimedOut(): Result<string, CompleteError> {
	return CompleteError.TransportFailed({
		cause: new Error(
			`The AI provider did not answer within ${COMPLETION_TIMEOUT_MS / 1000} seconds.`,
		),
	});
}

/**
 * Run the completion with a deadline, mapping an expiry to a failure the
 * caller can degrade from.
 *
 * The distinction between the two aborts is the whole point. A person hitting
 * "ship raw" is a clean outcome and `runPolish` returns the raw transcript with
 * no notice, keyed on the *caller's* signal. The deadline aborts a private
 * controller instead, so the caller's signal stays unaborted and the same code
 * path reports a skipped pass. Losing the polish is the right trade; losing the
 * dictation, or silently pretending the user asked for raw text, is not.
 */
async function completeWithDeadline(
	app: TironianApp,
	{
		connection,
		systemPrompt,
		userPrompt,
		signal,
	}: {
		connection: Parameters<typeof complete>[0];
		systemPrompt: string;
		userPrompt: string;
		signal?: AbortSignal;
	},
): Promise<Result<string, CompleteError>> {
	const controller = new AbortController();
	let expired = false;
	const timer = setTimeout(() => {
		expired = true;
		controller.abort();
	}, COMPLETION_TIMEOUT_MS);
	const forwardAbort = () => controller.abort();
	if (signal?.aborted) controller.abort();
	else signal?.addEventListener('abort', forwardAbort, { once: true });

	try {
		const result = await complete(connection, {
			model: app.settings.get('completionModel').trim(),
			systemPrompt,
			userPrompt,
			signal: controller.signal,
		});
		if (expired) return completionTimedOut();
		return result;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', forwardAbort);
	}
}
