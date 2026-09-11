/**
 * Import parsing, kept pure and separate from the app-level side effects
 * (`app.snippets.set`) so the validation rules are testable without a store.
 */

import { nanoid } from 'nanoid/non-secure';
import { Err, Ok, type Result } from 'wellcrafted/result';
import type { TironianApp } from '$lib/app/app';

/** Matches the export shape: no id, since ids are minted (ADR-0206) and not portable. */
export type ImportedSnippet = { trigger: string; replacement: string };

const MAX_REPLACEMENT_LENGTH = 2000;

export type ImportParseError = { type: 'NotJson' } | { type: 'NotAnArray' };

/**
 * Validates already-parsed JSON into a list of well-formed snippets. Silently
 * drops individual malformed entries rather than failing the whole import: a
 * file hand-edited or exported from a future version may carry one bad row, and
 * that shouldn't block the rest.
 *
 * Separate from `parseSnippetsImport` so the settings bundle importer, which
 * receives a `snippets` array already parsed as part of a larger document, can
 * validate it without a stringify-then-reparse round trip.
 */
export function validateSnippetsArray(
	parsed: unknown,
): Result<{ valid: ImportedSnippet[]; rejected: number }, ImportParseError> {
	if (!Array.isArray(parsed)) return Err({ type: 'NotAnArray' });

	const valid: ImportedSnippet[] = [];
	let rejected = 0;
	for (const entry of parsed) {
		if (typeof entry !== 'object' || entry === null) {
			rejected += 1;
			continue;
		}
		const { trigger, replacement } = entry as Record<string, unknown>;
		if (
			typeof trigger !== 'string' ||
			typeof replacement !== 'string' ||
			trigger.trim() === '' ||
			replacement.trim() === '' ||
			replacement.length > MAX_REPLACEMENT_LENGTH
		) {
			rejected += 1;
			continue;
		}
		valid.push({ trigger: trigger.trim(), replacement: replacement.trim() });
	}
	return Ok({ valid, rejected });
}

/** Parses the raw text of a standalone `snippets.json`, then validates it. */
export function parseSnippetsImport(
	text: string,
): Result<{ valid: ImportedSnippet[]; rejected: number }, ImportParseError> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return Err({ type: 'NotJson' });
	}
	return validateSnippetsArray(parsed);
}

/**
 * Drops entries whose trigger collides with an existing snippet or with an
 * earlier entry in the same file (case-insensitive, matching the matcher's
 * own case-folding). First occurrence wins; the rest are reported as skipped
 * rather than silently overwriting anything, since there is no overwrite mode.
 */
export function dedupeAgainstExisting(
	imported: readonly ImportedSnippet[],
	existingTriggers: readonly string[],
): { toCreate: ImportedSnippet[]; skippedDuplicate: number } {
	const seen = new Set(existingTriggers.map((t) => t.toLowerCase()));
	const toCreate: ImportedSnippet[] = [];
	let skippedDuplicate = 0;
	for (const entry of imported) {
		const key = entry.trigger.toLowerCase();
		if (seen.has(key)) {
			skippedDuplicate += 1;
			continue;
		}
		seen.add(key);
		toCreate.push(entry);
	}
	return { toCreate, skippedDuplicate };
}

export type SnippetsImportSummary = {
	created: number;
	skippedDuplicate: number;
	rejected: number;
};

/** Parses, dedupes against the live table, and writes the survivors. */
export function importSnippets(
	app: TironianApp,
	text: string,
): Result<SnippetsImportSummary, ImportParseError> {
	const parsed = parseSnippetsImport(text);
	if (parsed.error) return Err(parsed.error);

	const existingTriggers = app.snippets.all.map((row) => row.trigger);
	const { toCreate, skippedDuplicate } = dedupeAgainstExisting(
		parsed.data.valid,
		existingTriggers,
	);
	for (const { trigger, replacement } of toCreate) {
		app.snippets.set({ id: nanoid(), trigger, replacement });
	}
	return Ok({
		created: toCreate.length,
		skippedDuplicate,
		rejected: parsed.data.rejected,
	});
}
