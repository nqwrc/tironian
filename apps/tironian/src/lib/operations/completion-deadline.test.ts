/**
 * Completion Deadline Tests
 *
 * Polish and every Recipe share one call path, so the deadline lives there
 * once. Neither call had one before: a provider that never answered held the
 * transcript behind the pill's "Flowing…" HUD indefinitely, and now that
 * pipeline runs are serialized it would hold every later utterance with it.
 *
 * Key behaviors:
 * - The expiry failure names the duration, so the notice says waiting longer
 *   would not have helped
 * - A caller's own abort ("ship raw") stays a caller abort and is never
 *   reported as a timeout
 * - A call that answers is passed through untouched
 *
 * The deadline itself is 30s of wall clock and is not waited out here. The
 * division follows `decideSecureFieldGuard`: the decision is pure and tested,
 * the timer stays in the impure caller.
 */
import { expect, mock, test } from 'bun:test';
import { Ok } from 'wellcrafted/result';

/** Resolves only once the request's signal aborts, standing in for a hung provider. */
function neverAnswers(
	_connection: unknown,
	{ signal }: { signal: AbortSignal },
) {
	return new Promise((resolve) => {
		signal.addEventListener('abort', () => resolve(Ok('unreachable')), {
			once: true,
		});
	});
}

let completeImpl: (connection: unknown, args: never) => unknown = async () =>
	Ok('completed');

mock.module('@tironian/client', () => ({
	complete: (connection: unknown, args: never) =>
		completeImpl(connection, args),
	resolveConnection: () => ({}),
	CompleteError: {
		TransportFailed: ({ cause }: { cause: Error }) => ({
			data: null,
			error: { name: 'TransportFailed', message: cause.message, cause },
		}),
	},
}));
mock.module('#platform/http', () => ({ customFetch: mock() }));
// Two test files fake this module and `mock.module` is process-global, with
// the first registration winning, so this fake carries what every importer
// needs rather than only what this file reads. `run-polish.ts` imports
// `describePolishDestination` at module scope; omitting it here fails that
// file's import with a SyntaxError that names neither test.
mock.module('$lib/operations/completion-target', () => ({
	resolveCompletionStateFromConfig: () => ({
		target: { baseUrl: 'https://example.invalid', apiKey: 'k' },
		canRun: true,
		textStaysOnDevice: false,
	}),
	describePolishDestination: () => '',
}));
mock.module('$lib/state/device-config.svelte', () => ({
	deviceConfig: { get: () => ({}) },
}));

const { completeWithGlobalDefault, completionTimedOut, COMPLETION_TIMEOUT_MS } =
	await import('./completion.js');
type TironianApp = import('$lib/app/app').TironianApp;

const app = { settings: { get: () => 'model' } } as unknown as TironianApp;

function run(signal?: AbortSignal) {
	return completeWithGlobalDefault(app, {
		systemPrompt: 'system',
		userPrompt: 'user',
		signal,
	});
}

test('the expiry failure names the duration it waited', () => {
	const result = completionTimedOut() as {
		error: { message: string } | null;
	};
	expect(result.error?.message).toBe(
		`The AI provider did not answer within ${COMPLETION_TIMEOUT_MS / 1000} seconds.`,
	);
});

/**
 * The subtle half, and the reason the deadline aborts a private controller
 * rather than the signal it was handed. `runPolish` decides "the person asked
 * for raw text" by reading the caller's own signal, so a deadline that aborted
 * that signal would make every timeout look like a deliberate cancel: raw text
 * shipped with no notice and nothing to explain the wait.
 */
test("a caller's abort leaves the caller's signal the aborted one", async () => {
	completeImpl = neverAnswers as typeof completeImpl;
	const controller = new AbortController();
	const started = run(controller.signal);
	controller.abort();
	const result = (await started) as { error: { message: string } | null };

	expect(controller.signal.aborted).toBe(true);
	expect(result.error?.message ?? '').not.toContain('did not answer within');
});

test('a call that answers is passed through untouched', async () => {
	completeImpl = async () => Ok('polished');
	expect(await run()).toEqual(Ok('polished'));
});
