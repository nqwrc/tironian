/**
 * The text around the cursor is never logged (ADR-0272). Every function the
 * slice passes through runs here with a sentinel in it while `console` is
 * watched; `wellcrafted/logger` and `report` both end at `console`. The
 * pipeline half (no notice, no row) is in `command-mode-pipeline.test.ts`.
 */
import { expect, spyOn, test } from 'bun:test';
import { buildPolishSystemPrompt } from './build-system-prompt';
import {
	buildTranscriptionPrompt,
	WHISPER_PROMPT_CHAR_BUDGET,
} from './build-transcription-prompt';
import {
	captureCursorContext,
	echoesCursorContext,
} from './cursor-context-core';

const SENTINEL = 'ZQXJ7731';
const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
const seen: unknown[] = [];

/** Watches `console` for the length of `body`, then puts it back. */
async function watchingConsole(body: () => Promise<void>): Promise<void> {
	const spies = METHODS.map((method) =>
		spyOn(console, method).mockImplementation((...args: unknown[]) => {
			seen.push(...args);
		}),
	);
	try {
		await body();
	} finally {
		for (const spy of spies) spy.mockRestore();
	}
}

function printed(): string {
	return seen
		.map((arg) =>
			arg instanceof Error
				? `${arg.name} ${arg.message} ${arg.stack ?? ''}`
				: typeof arg === 'string'
					? arg
					: JSON.stringify(arg),
		)
		.join('\n');
}

test('the watcher sees a console line that carries the sentinel', async () => {
	seen.length = 0;
	await watchingConsole(async () => {
		console.error(`control ${SENTINEL}`);
	});
	expect(printed()).toContain(SENTINEL);
	seen.length = 0;
});

test('no console output carries the slice on its way into either prompt', async () => {
	seen.length = 0;
	const field = {
		before: `Zorv blenta, wuxo quenta ${SENTINEL} prulla `,
		selection: SENTINEL,
		after: ` e con ${SENTINEL}.`,
	};
	await watchingConsole(async () => {
		const context = await captureCursorContext(
			{
				windows: true,
				reader: {
					readContextAtCapture: async () => ({ kind: 'context', ...field }),
				},
			},
			true,
		);
		if (context === null)
			throw new Error('the read should have kept the slice');
		buildTranscriptionPrompt(
			'',
			['Kubernetes'],
			WHISPER_PROMPT_CHAR_BUDGET,
			context.before,
		);
		buildTranscriptionPrompt('', null, null, context.before);
		buildPolishSystemPrompt('Fix grammar.', ['Kubernetes'], {
			trusted: true,
			cursorContext: context,
		});
		buildPolishSystemPrompt('Fix grammar.', null, {
			trusted: false,
			cursorContext: context,
		});
		echoesCursorContext(`wuxo quenta ${SENTINEL}`, '', context);
		await captureCursorContext(
			{
				windows: true,
				reader: {
					readContextAtCapture: () => Promise.reject(new Error(SENTINEL)),
				},
			},
			true,
		);
	});
	expect(printed()).not.toContain(SENTINEL);
});
