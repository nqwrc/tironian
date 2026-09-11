/**
 * Embedded SQLite Adapter Conformance Tests
 *
 * Verifies that every runtime adapter exposes the same query and transaction
 * semantics without depending on an authority or workspace schema.
 *
 * Key behaviors:
 * - bound writes and object-row reads agree across adapters
 * - transaction exceptions roll back every write
 */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createBunSqliteAdapter } from './bun.js';
import type { SqliteDatabase } from './index.js';

type OpenDatabase = () => {
	database: SqliteDatabase;
	close(): void;
};

const adapters: [name: string, open: OpenDatabase][] = [
	[
		'Bun SQLite',
		() => {
			const sqlite = new Database(':memory:');
			return {
				database: createBunSqliteAdapter(sqlite),
				close: () => sqlite.close(),
			};
		},
	],
];

for (const [name, open] of adapters) {
	test(`${name}: writes, reads, and rollback share one contract`, () => {
		const { database, close } = open();
		try {
			database.run('CREATE TABLE values_table(value TEXT NOT NULL)');
			database.run('INSERT INTO values_table VALUES (?)', ['kept']);
			expect(() =>
				database.transaction(() => {
					database.run('INSERT INTO values_table VALUES (?)', ['rolled-back']);
					throw new Error('rollback');
				}),
			).toThrow('rollback');
			expect(
				database.all<{ value: string }>(
					'SELECT value FROM values_table ORDER BY rowid',
				),
			).toEqual([{ value: 'kept' }]);
		} finally {
			close();
		}
	});
}
