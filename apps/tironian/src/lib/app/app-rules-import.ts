/**
 * Validation and dedupe for app rules arriving in a settings bundle.
 *
 * The `recipes-import.ts` shape: a structural check per entry (reject rather
 * than repair), then an additive dedupe against the live table, because a
 * table is work and replacing it would delete rows nobody asked to lose
 * (ADR-0266). Dedupe is by identifier, the same fact the rules editor
 * refuses duplicates on: two rules matching the same app would race on row
 * id, so an incoming rule whose exe or bundle id is already claimed is
 * skipped rather than created.
 *
 * `enabled` is validated but not honored: `applySettingsBundle` creates every
 * imported rule disabled, and untrusted with it. The field stays in the check
 * because a file that omits it is malformed, and because the export writes it.
 */
import { Err, Ok, type Result } from 'wellcrafted/result';
import type { AppRule } from '../workspace';

/**
 * The file cannot express `trusted`, and that is the point: standing is granted
 * by the person importing, never claimed by the document being imported.
 */
export type BundleAppRule = Omit<AppRule, 'id' | 'trusted'>;

export type AppRulesValidationError = { type: 'NotAnArray' };

function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string';
}

export function validateAppRulesArray(
	input: unknown,
): Result<
	{ valid: BundleAppRule[]; rejected: number },
	AppRulesValidationError
> {
	if (!Array.isArray(input)) return Err({ type: 'NotAnArray' });

	const valid: BundleAppRule[] = [];
	let rejected = 0;
	for (const entry of input) {
		if (typeof entry !== 'object' || entry === null) {
			rejected += 1;
			continue;
		}
		const rule = entry as Record<string, unknown>;
		const conforms =
			typeof rule.name === 'string' &&
			rule.name.trim() !== '' &&
			isNullableString(rule.matchWindowsExe) &&
			isNullableString(rule.matchMacosBundleId) &&
			(rule.matchWindowsExe !== null || rule.matchMacosBundleId !== null) &&
			isNullableString(rule.polishInstructions) &&
			isNullableString(rule.recipeId) &&
			typeof rule.enabled === 'boolean';
		if (!conforms) {
			rejected += 1;
			continue;
		}
		valid.push({
			name: (rule.name as string).trim(),
			matchWindowsExe:
				(rule.matchWindowsExe as string | null)?.toLowerCase() ?? null,
			matchMacosBundleId: rule.matchMacosBundleId as string | null,
			polishInstructions: rule.polishInstructions as string | null,
			recipeId: rule.recipeId as string | null,
			enabled: rule.enabled as boolean,
		});
	}
	return Ok({ valid, rejected });
}

export function dedupeAppRulesAgainstExisting(
	incoming: BundleAppRule[],
	existing: readonly AppRule[],
): { toCreate: BundleAppRule[]; skippedDuplicate: number } {
	const claimedExes = new Set(
		existing
			.map((rule) => rule.matchWindowsExe?.toLowerCase())
			.filter((id): id is string => id != null),
	);
	const claimedBundles = new Set(
		existing
			.map((rule) => rule.matchMacosBundleId?.toLowerCase())
			.filter((id): id is string => id != null),
	);

	const toCreate: BundleAppRule[] = [];
	let skippedDuplicate = 0;
	for (const rule of incoming) {
		const exe = rule.matchWindowsExe?.toLowerCase();
		const bundle = rule.matchMacosBundleId?.toLowerCase();
		if (
			(exe && claimedExes.has(exe)) ||
			(bundle && claimedBundles.has(bundle))
		) {
			skippedDuplicate += 1;
			continue;
		}
		if (exe) claimedExes.add(exe);
		if (bundle) claimedBundles.add(bundle);
		toCreate.push(rule);
	}
	return { toCreate, skippedDuplicate };
}
