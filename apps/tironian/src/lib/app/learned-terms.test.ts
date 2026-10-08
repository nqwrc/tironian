import { expect, test } from 'bun:test';

// Runes are not compiled under bun test; stub them as app-rules.test.ts:12-15 does.
(globalThis as unknown as { $state: unknown }).$state = Object.assign(
	<TValue>(value: TValue) => value,
	{ raw: <TValue>(value: TValue) => value },
);
const { createTironianLearnedTerms } = await import(
	'./learned-terms.svelte.js'
);

function fakeTable<TRow extends { id: string }>() {
	const rows: TRow[] = [];
	let n = 0;
	return {
		rows,
		list: () => ({ rows: [...rows], nonconforming: [] }),
		subscribe: () => () => {},
		create: (fields: Omit<TRow, 'id'>) => {
			const row = { id: `r${++n}`, ...fields } as TRow;
			rows.push(row);
			return row;
		},
		update: (id: string, fields: Partial<TRow>) => {
			Object.assign(rows.find((r) => r.id === id)!, fields);
			return { data: undefined, error: null };
		},
		delete: (id: string) => {
			const at = rows.findIndex((r) => r.id === id);
			if (at === -1) return false;
			rows.splice(at, 1);
			return true;
		},
	};
}

type Row = {
	id: string;
	term: string;
	status: 'pending' | 'active';
	learnedAt: string;
};
const setup = () => {
	const table = fakeTable<Row>();
	const forgotten = fakeTable<{ id: string; hash: string }>();
	const terms = createTironianLearnedTerms({
		table: table as never,
		forgotten: forgotten as never,
	});
	return { table, forgotten, terms };
};

test('a new term is pending and reaches no glossary until activated', () => {
	const { terms } = setup();
	const id = terms.create('Kubernetes');
	expect(terms.pending.map((r) => r.term)).toEqual(['Kubernetes']);
	expect(terms.activeTerms).toEqual([]);
	terms.activate(id);
	expect(terms.activeTerms).toEqual(['Kubernetes']);
	expect(terms.pending).toEqual([]);
});

test('forget deletes the row and keeps only the hash', async () => {
	const { forgotten, table, terms } = setup();
	const id = terms.create('Kubernetes');
	await terms.forget(id);
	expect(table.rows).toEqual([]);
	expect(forgotten.rows.map((r) => r.hash)).toEqual([
		'94abcb2d2773df65cda0708afd551ea23131ec18400d7694cd971b016d86e7ae',
	]);
	expect(JSON.stringify(forgotten.rows).toLowerCase()).not.toContain(
		'kubernetes',
	);
	expect(terms.known(null).forgotten(forgotten.rows[0]!.hash)).toBe(true);
});

test('known folds the manual dictionary and active terms, and finds pending rows', () => {
	const { terms } = setup();
	const jira = terms.create('Jira');
	terms.activate(jira);
	const pending = terms.create('Nicolò');
	const known = terms.known(['GitHub']);
	expect(known.inUse('github')).toBe(true);
	expect(known.inUse('jira')).toBe(true);
	expect(known.pendingId('nicolo')).toBe(pending);
	expect(known.rowCount).toBe(2);
});

test('active is newest first', async () => {
	const { terms } = setup();
	terms.activate(terms.create('Jira'));
	await new Promise((r) => setTimeout(r, 5));
	terms.activate(terms.create('GitHub'));
	expect(terms.activeTerms).toEqual(['GitHub', 'Jira']);
});
