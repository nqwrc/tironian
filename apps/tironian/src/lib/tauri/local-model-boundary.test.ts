import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Model administration and transcription are two namespaces of the Tauri
 * facade (ADR-0245): Settings chooses, downloads, and deletes models through
 * `models`, and the capture path transcribes through `transcription` without
 * ever naming a model.
 *
 * Reading the facade as text rather than importing it keeps this test off the
 * Tauri runtime, which does not exist under `bun test`.
 */
const facade = readFileSync(
	fileURLToPath(new URL('../tauri.tauri.ts', import.meta.url)),
	'utf8',
);

/** The body of one `const <name> = {` namespace block in the facade. */
function namespace(name: string): string {
	const start = facade.indexOf(`const ${name} = {`);
	return facade.slice(start, facade.indexOf('\n};', start));
}

const ADMINISTRATION = [
	'getActiveModel',
	'setActiveModel',
	'listModels',
	'downloadModel',
	'deleteModel',
	'cancelDownload',
	'getUnloadPolicy',
	'setUnloadPolicy',
];

describe('the local model boundary inside the Tauri facade', () => {
	it('keeps administration out of the transcription namespace', () => {
		const transcription = namespace('transcription');
		for (const command of ADMINISTRATION) {
			expect(transcription).not.toContain(command);
		}
	});

	it('puts every administration command in the models namespace', () => {
		const models = namespace('models');
		for (const command of ADMINISTRATION) {
			expect(models).toContain(command);
		}
	});

	it('transcribes and reads readiness without a second window to open', () => {
		const transcription = namespace('transcription');
		for (const command of [
			'getLocalTranscriptionReadiness',
			'transcribeRecording',
			'prewarmModel',
		]) {
			expect(transcription).toContain(command);
		}
		expect(facade).not.toContain('openHome');
	});

	it('cannot name a model when it asks for a transcription', () => {
		// The absence of a model argument is the invariant. `TranscriptionHints`
		// is the whole per-call input, so if it ever grows a model field an
		// ordinary request could reassign the shared cache again.
		const hints = readFileSync(
			fileURLToPath(new URL('./commands.types.ts', import.meta.url)),
			'utf8',
		);
		const block = hints.slice(
			hints.indexOf('export type TranscriptionHints'),
			hints.indexOf('};', hints.indexOf('export type TranscriptionHints')),
		);
		expect(block).not.toMatch(/model/i);
	});
});
