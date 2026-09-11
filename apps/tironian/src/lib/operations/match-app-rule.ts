/**
 * Resolve which per-application rule applies to the app that was in front
 * when the dictation started.
 *
 * Pure and total, like `expand-snippets.ts`: rows in, one rule or null out.
 * Matching is a case-insensitive exact comparison against the platform's own
 * identifier field; a rule whose field for this platform is null simply never
 * matches here, which is what lets one synced "Terminal" rule carry both a
 * Windows exe name and a macOS bundle id (ADR-0233). No globs or prefixes in
 * v1: an app identity is a name, not a pattern.
 *
 * The UI refuses saving two rules with the same identifier, so ordering
 * should never decide a real match; ties still resolve deterministically by
 * row id so sync order cannot flip the outcome, the same law snippets use.
 */
import type { AppRule } from '$lib/workspace';

/** The platforms an identifier field exists for. `other` never matches. */
export type AppRulePlatform = 'windows' | 'macos' | 'other';

export function matchAppRule({
	appId,
	rules,
	platform,
}: {
	/** Foreground identity at recording start, or null when the OS refused. */
	appId: string | null;
	rules: readonly AppRule[];
	platform: AppRulePlatform;
}): AppRule | null {
	if (appId === null || platform === 'other') return null;
	const wanted = appId.toLowerCase();

	const identifier = (rule: AppRule): string | null =>
		platform === 'windows' ? rule.matchWindowsExe : rule.matchMacosBundleId;

	const matches = rules.filter(
		(rule) => rule.enabled && identifier(rule)?.toLowerCase() === wanted,
	);
	return (
		matches.toSorted((left, right) => left.id.localeCompare(right.id))[0] ??
		null
	);
}
