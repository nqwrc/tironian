import { describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Invariants over the message catalogue, as tests rather than as a convention
 * nobody enforces. Both of these were real defects during the extraction, not
 * hypotheticals: the codemod baked the product name into thirteen messages, and
 * left eleven behind with no call site.
 *
 * They run in the ordinary suite because they need no build and no browser,
 * which matters here: this app has no render path to check against, so a cheap
 * invariant is worth more than usual.
 */

/** Resolved from this file rather than the cwd, which differs between a
 * repo-root run and `bun run --cwd apps/tironian test`. */
const APP = path.resolve(import.meta.dir, '../..');
const PRODUCT_NAME = 'Tironian';

const en = JSON.parse(
	readFileSync(`${APP}/messages/en.json`, 'utf8'),
) as Record<string, string>;
// Not `it`: that name is the test function, and shadowing it turns every
// assertion below into a call on a JSON object.
const italian = JSON.parse(
	readFileSync(`${APP}/messages/it.json`, 'utf8'),
) as Record<string, string>;

const keys = (catalogue: Record<string, string>) =>
	Object.keys(catalogue).filter((key) => !key.startsWith('$'));

/** Every source file, read once and joined: the call sites live across 80 of them. */
const sources = execSync('git ls-files src', { cwd: APP, encoding: 'utf8' })
	.split('\n')
	.filter(
		(file) =>
			(file.endsWith('.svelte') || file.endsWith('.ts')) &&
			!file.includes('/paraglide/'),
	)
	.map((file) => readFileSync(path.join(APP, file), 'utf8'))
	.join('\n');

const called = new Set(
	[...sources.matchAll(/\bm\.([A-Za-z0-9_]+)\s*\(/g)].map((match) => match[1]),
);

describe('the message catalogue', () => {
	it('carries no message that nothing calls', () => {
		// An unused message is debt in every locale at once: somebody has to read
		// it, decide whether it is live, and translate it before finding out it is
		// not.
		expect(keys(en).filter((key) => !called.has(key))).toEqual([]);
	});

	it('never bakes the product name into a message', () => {
		// The rebrand put the name in one constant on purpose. A message holding
		// the literal would put it back in the catalogue, once per locale, where
		// the next rename would have to go and find it.
		const baked = Object.entries(en)
			.filter(([key]) => !key.startsWith('$'))
			.filter(([, value]) => value.includes(PRODUCT_NAME))
			.map(([key]) => key);
		expect(baked).toEqual([]);
	});

	it('translates only keys the source language defines', () => {
		// A translation for a key that no longer exists is invisible: it compiles,
		// it ships, and it is never rendered.
		expect(keys(italian).filter((key) => !(key in en))).toEqual([]);
	});

	it('keeps the same placeholders in every translation', () => {
		// A translation that drops `{productName}` renders a sentence with a hole
		// in it, and a translation that invents a placeholder throws at runtime.
		const placeholders = (text: string) =>
			[...text.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
		const mismatched = keys(italian).filter((key) => {
			const source = en[key];
			const translation = italian[key];
			// A key absent from the source is the previous test's finding, not this
			// one's; skipping it here keeps each failure pointing at one cause.
			if (source === undefined || translation === undefined) return false;
			return placeholders(translation).join() !== placeholders(source).join();
		});
		expect(mismatched).toEqual([]);
	});
});
