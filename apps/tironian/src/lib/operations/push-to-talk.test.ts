import { expect, mock, test } from 'bun:test';
import { type BlobId, generateBlobId } from '@tironian/blobs';
import type { TironianApp } from '$lib/app/app';

let recorderState: 'STOPPED' | 'RECORDING' = 'STOPPED';
let recorderIsStarting = false;
const startManualRecording =
	mock<(app: TironianApp) => Promise<BlobId | null>>();
const stopManualRecordingById = mock(async () => {});

mock.module('$lib/report', () => ({
	log: { warn: mock() },
	report: { info: mock() },
}));
mock.module('$lib/state/manual-recorder.svelte', () => ({
	manualRecorder: {
		get state() {
			return recorderState;
		},
		get isStarting() {
			return recorderIsStarting;
		},
	},
}));
mock.module('./recording', () => ({
	startManualRecording,
	stopManualRecordingById,
}));

const { createPushToTalk, pushToTalk } = await import('./push-to-talk');
const app = {} as TironianApp;

test('dispose stops an active push-to-talk recording before app teardown', async () => {
	const recordingId = generateBlobId();
	startManualRecording.mockImplementationOnce(async () => recordingId);

	await pushToTalk.start(app);
	recorderState = 'RECORDING';
	await pushToTalk.dispose(app);

	expect(stopManualRecordingById).toHaveBeenLastCalledWith(app, recordingId);
	recorderState = 'STOPPED';
});

test('dispose cannot retire another app session', async () => {
	const recordingId = generateBlobId();
	const otherApp = {} as TironianApp;
	const stopsBefore = stopManualRecordingById.mock.calls.length;
	startManualRecording.mockImplementationOnce(async () => recordingId);

	await pushToTalk.start(app);
	recorderState = 'RECORDING';
	await pushToTalk.dispose(otherApp);

	expect(stopManualRecordingById).toHaveBeenCalledTimes(stopsBefore);
	await pushToTalk.dispose(app);
	recorderState = 'STOPPED';
});

test('dispose invalidates and drains a recording start already in flight', async () => {
	const recordingId = generateBlobId();
	let resolveStart!: (id: BlobId) => void;
	startManualRecording.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveStart = resolve;
			}),
	);
	recorderIsStarting = true;

	const start = pushToTalk.start(app);
	const disposal = pushToTalk.dispose(app);
	resolveStart(recordingId);
	await Promise.all([start, disposal]);

	expect(stopManualRecordingById).toHaveBeenLastCalledWith(app, recordingId);
	recorderIsStarting = false;
});

test('a held session is cut at the hold cap', async () => {
	const ptt = createPushToTalk({ holdCapMs: 30, lockedCapMs: 500 });
	const recordingId = generateBlobId();
	startManualRecording.mockImplementationOnce(async () => recordingId);
	stopManualRecordingById.mockClear();

	await ptt.start(app);
	recorderState = 'RECORDING';
	await Bun.sleep(80);

	expect(stopManualRecordingById).toHaveBeenLastCalledWith(app, recordingId);
	recorderState = 'STOPPED';
});

test('a session hands-free locked open gets the long cap, counted from the lock', async () => {
	const ptt = createPushToTalk({ holdCapMs: 30, lockedCapMs: 150 });
	const recordingId = generateBlobId();
	startManualRecording.mockImplementationOnce(async () => recordingId);
	stopManualRecordingById.mockClear();

	await ptt.start(app);
	recorderState = 'RECORDING';
	ptt.lockOpen(app);
	await Bun.sleep(80); // past the hold cap: still recording
	expect(stopManualRecordingById).not.toHaveBeenCalled();

	await Bun.sleep(150); // past the locked cap
	expect(stopManualRecordingById).toHaveBeenLastCalledWith(app, recordingId);
	recorderState = 'STOPPED';
});

test('a lock that lands while startup is in flight still arms the long cap', async () => {
	const ptt = createPushToTalk({ holdCapMs: 30, lockedCapMs: 150 });
	const recordingId = generateBlobId();
	let resolveStart!: (id: BlobId) => void;
	startManualRecording.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveStart = resolve;
			}),
	);
	stopManualRecordingById.mockClear();

	const starting = ptt.start(app);
	ptt.lockOpen(app);
	resolveStart(recordingId);
	await starting;
	recorderState = 'RECORDING';
	await Bun.sleep(80);
	expect(stopManualRecordingById).not.toHaveBeenCalled();

	await ptt.dispose(app);
	recorderState = 'STOPPED';
});

test('lockOpen from another app or with no session does nothing', async () => {
	const ptt = createPushToTalk({ holdCapMs: 30, lockedCapMs: 500 });
	ptt.lockOpen(app); // no session: no throw
	const recordingId = generateBlobId();
	startManualRecording.mockImplementationOnce(async () => recordingId);
	stopManualRecordingById.mockClear();

	await ptt.start(app);
	recorderState = 'RECORDING';
	ptt.lockOpen({} as TironianApp); // not this session's app
	await Bun.sleep(80);
	expect(stopManualRecordingById).toHaveBeenLastCalledWith(app, recordingId);
	recorderState = 'STOPPED';
});
