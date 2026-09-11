/**
 * Whispering app acquisition tests.
 *
 * The device document opens for every page lifetime and holds this machine's
 * settings and its work (recordings, recipes): there is no account and no
 * sync, so a boot has exactly one document to open. These tests pin that,
 * which is the whole of what this app's composition decides.
 *
 * Key behaviors:
 * - A boot opens one device document
 * - Settings recover application defaults and survive a restart
 * - Recordings and settings persist across a restart
 * - An aborted boot rejects with the abort and leaves nothing open
 *
 * `fake-indexeddb` supplies the browser store's storage.
 */
import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { InstantString } from '@epicenter/field';

// The recipes domain IS reactive state, so the runes are shimmed to their
// non-reactive meaning (the pattern the other runtime tests use). These
// assertions read imperatively: the question is which document a write landed
// in, not whether a view recomputed.
(globalThis as unknown as { $state: unknown }).$state = Object.assign(
	<TValue>(value: TValue) => value,
	{ raw: <TValue>(value: TValue) => value },
);
(globalThis as unknown as { $derived: unknown }).$derived = Object.assign(
	<TValue>(value: TValue) => value,
	{ by: <TValue>(derive: () => TValue) => derive() },
);

import type { BlobStore } from '@epicenter/blobs';
import { Ok } from 'wellcrafted/result';
import { whisperingDefinition } from '../workspace';
import { openWhisperingApp, type WhisperingAppDependencies } from './app';

const local: BlobStore = {
	async put() {
		return Ok(undefined);
	},
	async get() {
		return Ok(new Blob());
	},
	async stat() {
		return Ok({ size: 0, contentType: 'application/octet-stream' });
	},
	async delete() {
		return Ok(undefined);
	},
};

/**
 * Start each test from empty storage. IndexedDB outlives a test in this
 * process the way it outlives a page in a browser, and these tests each tell a
 * whole multi-generation story from a fresh install.
 */
async function resetStorage(): Promise<void> {
	for (const database of await indexedDB.databases()) {
		const name = database.name;
		if (name === undefined) continue;
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase(name);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}
}

const dependencies: WhisperingAppDependencies = {
	blobs: { local },
};

/** The whole create input; only the title matters to these tests. */
function recordingFields(title: string) {
	return {
		audioBlobId: 'blob_aaaaaaaaaaaaaaaaaaaaa' as never,
		title,
		recordedAt: InstantString.fromDate(new Date('2026-08-10T00:00:00.000Z')),
		recordedAtZone: 'UTC',
		transcript: '',
		polishedTranscript: null,
		duration: null,
	};
}

test('a boot opens exactly one document', async () => {
	await resetStorage();
	await using app = await openWhisperingApp(dependencies);

	expect(app.recordings.count).toBe(0);
	expect(app.recipes.count).toBe(0);

	const names = (await indexedDB.databases()).map(({ name }) => name);
	expect(names).toContain(`epicenter/${whisperingDefinition.id}/device`);
});

test('settings recover application defaults and survive a restart', async () => {
	await resetStorage();
	{
		await using app = await openWhisperingApp(dependencies);
		// Chosen by the application, applied by a read, never stored.
		expect(app.settings.get('transcriptionService')).toBe('local');
		expect(app.settings.get('soundManualStart')).toBe(true);

		let notifications = 0;
		const stop = app.settings.subscribe(() => {
			notifications += 1;
		});
		app.settings.set('recordingPausePlayback', true);
		expect(app.settings.get('recordingPausePlayback')).toBe(true);
		expect(notifications).toBeGreaterThan(0);
		stop();
		await Bun.sleep(10);
	}

	await using reopened = await openWhisperingApp(dependencies);
	expect(reopened.settings.get('recordingPausePlayback')).toBe(true);
});

test('recordings persist across a restart', async () => {
	await resetStorage();
	{
		await using app = await openWhisperingApp(dependencies);
		app.recordings.create(recordingFields('written on this device'));
		await Bun.sleep(10);
	}

	await using reopened = await openWhisperingApp(dependencies);
	expect(reopened.recordings.sorted.map(({ title }) => title)).toEqual([
		'written on this device',
	]);
});

test('a stored epicenter transcriptionService reads back as local', async () => {
	await resetStorage();
	await using app = await openWhisperingApp(dependencies);
	// A row written before hosted transcription was removed: the closed
	// `field.select` no longer admits 'epicenter', so conformance drops just
	// this one key and the application default takes its place.
	app.settings.set('transcriptionService', 'epicenter' as never);
	await Bun.sleep(10);
	expect(app.settings.get('transcriptionService')).toBe('local');
});

test('an aborted boot rejects with the abort', async () => {
	await resetStorage();
	const controller = new AbortController();
	controller.abort(new Error('root unmounted'));

	expect(
		openWhisperingApp(dependencies, { signal: controller.signal }),
	).rejects.toThrow('root unmounted');
});
