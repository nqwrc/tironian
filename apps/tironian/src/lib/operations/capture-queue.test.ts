/**
 * The capture FIFO (ADR-0272). The queue is generic, so entries here are plain
 * objects and no module is mocked.
 */
import { expect, mock, test } from 'bun:test';
import { beginManualCapture, createCaptureQueue } from './capture-queue';

type Entry = { name: string };
const NONE: Entry = { name: 'none' };
const entry = (name: string): Entry => ({ name });

test('entries come out in the order they went in, then the empty one', () => {
	const queue = createCaptureQueue(NONE);
	const first = queue.begin(entry('first'));
	const second = queue.begin(entry('second'));
	expect(queue.take()).toBe(first);
	expect(queue.take()).toBe(second);
	expect(queue.take()).toBe(NONE);
});

test('a hands-free utterance still takes its own entry while the next one has begun', () => {
	const queue = createCaptureQueue(NONE);
	const one = queue.begin(entry('utterance 1'));
	const two = queue.begin(entry('utterance 2'));
	expect(queue.take()).toBe(one);
	expect(queue.take()).toBe(two);
});

test('discarding an entry removes that one, not the oldest', () => {
	const queue = createCaptureQueue(NONE);
	const older = queue.begin(entry('older'));
	const failed = queue.begin(entry('failed start'));
	queue.discard(failed);
	expect(queue.take()).toBe(older);
	expect(queue.take()).toBe(NONE);
});

test('discarding twice, or discarding nothing, removes nothing else', () => {
	const queue = createCaptureQueue(NONE);
	const kept = queue.begin(entry('kept'));
	const gone = queue.begin(entry('gone'));
	queue.discard(gone);
	queue.discard(gone);
	queue.discard(null);
	expect(queue.take()).toBe(kept);
	expect(queue.take()).toBe(NONE);
});

test('discardOldest drops the head', () => {
	const queue = createCaptureQueue(NONE);
	queue.begin(entry('head'));
	const next = queue.begin(entry('next'));
	queue.discardOldest();
	expect(queue.take()).toBe(next);
});

test('a manual start takes a snapshot and returns the entry it queued', () => {
	const queue = createCaptureQueue(NONE);
	const read = mock(() => entry('manual'));
	const started = beginManualCapture(queue, false, read);
	expect(read).toHaveBeenCalledTimes(1);
	expect(queue.take()).toBe(started as Entry);
});

test('a manual start while one is live reads nothing and queues nothing', () => {
	const queue = createCaptureQueue(NONE);
	const live = queue.begin(entry('live recording'));
	const read = mock(() => entry('second'));
	expect(beginManualCapture(queue, true, read)).toBeNull();
	expect(read).not.toHaveBeenCalled();
	expect(queue.take()).toBe(live);
	expect(queue.take()).toBe(NONE);
});

test('a failed manual start removes its own entry and leaves the live one', () => {
	const queue = createCaptureQueue(NONE);
	const live = queue.begin(entry('hands-free utterance'));
	const started = beginManualCapture(queue, false, () => entry('manual'));
	queue.discard(started);
	expect(queue.take()).toBe(live);
	expect(queue.take()).toBe(NONE);
});

test('a no-op start has nothing to discard, so the live recording keeps its entry', () => {
	const queue = createCaptureQueue(NONE);
	const live = queue.begin(entry('live recording'));
	queue.discard(beginManualCapture(queue, true, () => entry('second')));
	expect(queue.take()).toBe(live);
});
