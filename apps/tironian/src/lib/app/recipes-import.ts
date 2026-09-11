/**
 * Import validation for the Recipes category of a settings bundle, and (kept
 * for symmetry with `snippets-import.ts`) for a standalone `recipes.json`.
 * Pure and separate from `app.recipes.set` side effects, so the rules are
 * testable without a store.
 *
 * See `specs/20260830T130918-settings-import-export.md`.
 */
import { Err, Ok, type Result } from 'wellcrafted/result';

/** Matches the export shape: no id, since ids are minted (ADR-0206). */
export type ImportedRecipe = {
	name: string;
	instructions: string;
	icon: string | null;
};

/**
 * A recipe's instructions are a prompt, naturally longer than a Snippet's
 * replacement text. 10,000 is generous headroom, not a measured limit.
 */
const MAX_INSTRUCTIONS_LENGTH = 10_000;

export type ImportParseError = { type: 'NotJson' } | { type: 'NotAnArray' };

/**
 * Validates already-parsed JSON, e.g. a `recipes` array already parsed as part
 * of a larger settings bundle document. Drops individual malformed entries
 * rather than failing the whole import, matching the snippets importer.
 */
export function validateRecipesArray(
	parsed: unknown,
): Result<{ valid: ImportedRecipe[]; rejected: number }, ImportParseError> {
	if (!Array.isArray(parsed)) return Err({ type: 'NotAnArray' });

	const valid: ImportedRecipe[] = [];
	let rejected = 0;
	for (const entry of parsed) {
		if (typeof entry !== 'object' || entry === null) {
			rejected += 1;
			continue;
		}
		const { name, instructions, icon } = entry as Record<string, unknown>;
		const iconIsUsable =
			icon === undefined || icon === null || typeof icon === 'string';
		if (
			typeof name !== 'string' ||
			typeof instructions !== 'string' ||
			name.trim() === '' ||
			instructions.trim() === '' ||
			instructions.length > MAX_INSTRUCTIONS_LENGTH ||
			!iconIsUsable
		) {
			rejected += 1;
			continue;
		}
		valid.push({
			name: name.trim(),
			instructions: instructions.trim(),
			icon: icon ?? null,
		});
	}
	return Ok({ valid, rejected });
}

/** Parses the raw text of a standalone `recipes.json`, then validates it. */
export function parseRecipesImport(
	text: string,
): Result<{ valid: ImportedRecipe[]; rejected: number }, ImportParseError> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return Err({ type: 'NotJson' });
	}
	return validateRecipesArray(parsed);
}

/**
 * Drops entries whose name collides with an existing recipe or with an earlier
 * entry in the same file (case-insensitive). First occurrence wins: a recipe
 * has no other natural collision key the way a Snippet has its trigger.
 */
export function dedupeRecipesAgainstExisting(
	imported: readonly ImportedRecipe[],
	existingNames: readonly string[],
): { toCreate: ImportedRecipe[]; skippedDuplicate: number } {
	const seen = new Set(existingNames.map((name) => name.toLowerCase()));
	const toCreate: ImportedRecipe[] = [];
	let skippedDuplicate = 0;
	for (const entry of imported) {
		const key = entry.name.toLowerCase();
		if (seen.has(key)) {
			skippedDuplicate += 1;
			continue;
		}
		seen.add(key);
		toCreate.push(entry);
	}
	return { toCreate, skippedDuplicate };
}
