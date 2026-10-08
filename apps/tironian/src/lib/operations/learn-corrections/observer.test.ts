import { expect, mock, test } from 'bun:test';
import type { FieldRead } from '../field-read';
import { createCorrectionObserver } from './observer';

type Fake =
	| { region: string; before?: string; after?: string }
	| null
	| 'stall';

function harness(
	fields: Fake[],
	opts: { enabled?: boolean; hash?: (fold: string) => Promise<string> } = {},
) {
	let now = 0;
	const timers: { at: number; run: () => void; live: boolean }[] = [];
	let reads = 0;
	let release: (read: FieldRead) => void = () => {};
	const learn = mock((_: unknown) => {});
	const end = mock(() => {});
	let enabled = opts.enabled ?? true;
	const observer = createCorrectionObserver({
		read: () => {
			reads++;
			const field = fields.length > 1 ? fields.shift()! : fields[0]!;
			if (field === 'stall')
				return new Promise<FieldRead>((resolve) => {
					release = resolve;
				});
			return Promise.resolve<FieldRead>(
				field === null
					? { kind: 'unavailable' }
					: {
							kind: 'span',
							before: field.before ?? 'Note: ',
							region: field.region,
							after: field.after ?? ' End.',
						},
			);
		},
		end,
		schedule: (ms, run) => {
			const timer = { at: now + ms, run, live: true };
			timers.push(timer);
			return () => {
				timer.live = false;
			};
		},
		enabled: () => enabled,
		hash: opts.hash ?? (async (fold) => `h:${fold}`),
		known: () => ({
			inUse: () => false,
			pendingId: () => null,
			forgotten: () => false,
			rowCount: 0,
		}),
		learn,
	});
	async function advance(ms: number) {
		const until = now + ms;
		for (;;) {
			const next = timers
				.filter((t) => t.live && t.at <= until)
				.sort((a, b) => a.at - b.at)[0];
			if (!next) break;
			now = next.at;
			next.live = false;
			next.run();
			await new Promise((r) => setTimeout(r, 0));
		}
		now = until;
		await new Promise((r) => setTimeout(r, 0));
	}
	return {
		observer,
		advance,
		learn,
		end,
		reads: () => reads,
		release: (read: FieldRead) => release(read),
		setEnabled: (value: boolean) => {
			enabled = value;
		},
	};
}

const delivered = 'Deploy it on cubernetes tonight';
const fixed = 'Deploy it on Kubernetes tonight';

test('baseline, then two agreeing timer reads: learned once as pending, then closed', async () => {
	const h = harness([{ region: delivered }, { region: fixed }]);
	h.observer.open({ delivered });
	await h.advance(1000); // baseline
	await h.advance(14_000); // +15 s
	expect(h.learn).not.toHaveBeenCalled();
	await h.advance(30_000); // +45 s agrees with +15 s
	expect(h.learn).toHaveBeenCalledWith({ create: ['Kubernetes'], promote: [] });
	expect(h.observer.isObserving).toBe(false);
	expect(h.end).toHaveBeenCalledTimes(1);
});

test('the next dictation learns when it agrees with the previous timer read', async () => {
	const h = harness([{ region: delivered }, { region: fixed }]);
	h.observer.open({ delivered });
	await h.advance(15_000);
	h.observer.noteDictationStarting();
	await h.advance(0);
	expect(h.learn).toHaveBeenCalledWith({ create: ['Kubernetes'], promote: [] });
});

test('the next dictation with no earlier timer read closes without learning (EN)', async () => {
	const h = harness([
		{ region: delivered },
		{ region: 'Deploy it on Kubern tonight' },
	]);
	h.observer.open({ delivered });
	await h.advance(5000);
	h.observer.noteDictationStarting();
	await h.advance(0);
	expect(h.learn).not.toHaveBeenCalled();
	expect(h.observer.isObserving).toBe(false);
});

test('the next dictation that differs from the last timer read closes without learning (IT)', async () => {
	const d = 'Ho aggiornato il ticket su gira';
	const h = harness([
		{ region: d },
		{ region: 'Ho aggiornato il ticket su Jir' },
		{ region: 'Ho aggiornato il ticket su Jira' },
	]);
	h.observer.open({ delivered: d });
	await h.advance(15_000);
	h.observer.noteDictationStarting();
	await h.advance(0);
	expect(h.learn).not.toHaveBeenCalled();
	expect(h.observer.isObserving).toBe(false);
});

test('a next dictation while a timer read is in flight closes without learning', async () => {
	const h = harness([{ region: delivered }, 'stall']);
	h.observer.open({ delivered });
	await h.advance(15_000); // the +15 s read stalls
	h.observer.noteDictationStarting();
	expect(h.observer.isObserving).toBe(false);
	h.release({ kind: 'span', before: 'Note: ', region: fixed, after: ' End.' });
	await h.advance(0);
	expect(h.learn).not.toHaveBeenCalled();
});

test('a half-typed edit seen once is never learned', async () => {
	const h = harness([
		{ region: delivered },
		{ region: 'Deploy it on Kube tonight' },
		{ region: fixed },
		null,
	]);
	h.observer.open({ delivered });
	await h.advance(90_000);
	expect(h.learn).not.toHaveBeenCalled();
});

test('an emptied field closes for good (EN)', async () => {
	const h = harness([{ region: delivered }, { region: '' }]);
	h.observer.open({ delivered });
	await h.advance(90_000);
	expect(h.reads()).toBe(2);
	expect(h.observer.isObserving).toBe(false);
});

test('a new message in the same chat box closes for good (IT)', async () => {
	const d = 'Ciao Marco, a domani';
	const h = harness([
		{ region: d, before: '', after: '' },
		{
			region: 'Ciao Mario, ci vediamo stasera alle otto',
			before: '',
			after: '',
		},
	]);
	h.observer.open({ delivered: d });
	await h.advance(90_000);
	expect(h.reads()).toBe(2);
	expect(h.learn).not.toHaveBeenCalled();
});

test('a delivery under three words is never observed', () => {
	const h = harness([{ region: 'Ciao Marco' }]);
	h.observer.open({ delivered: 'Ciao Marco' });
	expect(h.observer.isObserving).toBe(false);
	expect(h.end).toHaveBeenCalledTimes(1);
});

test('an unavailable baseline retries once, then closes', async () => {
	const h = harness([null]);
	h.observer.open({ delivered });
	await h.advance(90_000);
	expect(h.reads()).toBe(2);
	expect(h.observer.isObserving).toBe(false);
});

test('turning learning off stops the next read', async () => {
	const h = harness([{ region: delivered }]);
	h.observer.open({ delivered });
	await h.advance(1000);
	h.setEnabled(false);
	await h.advance(90_000);
	expect(h.reads()).toBe(1);
	expect(h.end).toHaveBeenCalledTimes(1);
});

test('cancel stops everything and ends the host target', async () => {
	const h = harness([{ region: delivered }]);
	h.observer.open({ delivered });
	h.observer.cancel();
	await h.advance(90_000);
	expect(h.reads()).toBe(0);
	expect(h.end).toHaveBeenCalledTimes(1);
});

test('a new open replaces the old observation without ending the new host target', async () => {
	const h = harness([{ region: delivered }]);
	h.observer.open({ delivered });
	h.observer.open({ delivered: 'Ho aggiornato il ticket su gira' });
	expect(h.end).not.toHaveBeenCalled();
	expect(h.observer.isObserving).toBe(true);
});

test('a failure while deciding learns nothing and closes', async () => {
	const h = harness([{ region: delivered }, { region: fixed }], {
		hash: () => Promise.reject(new Error('no crypto')),
	});
	h.observer.open({ delivered });
	await h.advance(45_000);
	expect(h.learn).not.toHaveBeenCalled();
	expect(h.observer.isObserving).toBe(false);
});

test('a stalled read at the final check does not leave the observation open', async () => {
	const h = harness([{ region: delivered }, 'stall']);
	h.observer.open({ delivered });
	await h.advance(85_000); // the +15 s read stalls and never returns
	expect(h.observer.isObserving).toBe(false);
	expect(h.end).toHaveBeenCalledTimes(1);
});
