/**
 * Parses, inspects, and applies a settings bundle.
 *
 * Preference categories overwrite on apply: a boolean or a select has no
 * meaningful merge, and the person checked the category to get the file's
 * values. Snippets and Recipes stay additive, deduping against the live table
 * the same way their own standalone importers already do, because a table is
 * work rather than configuration and replacing it would delete rows nobody
 * asked to lose.
 *
 * A bundle is a file, and the person importing it is not necessarily the person
 * who wrote it. Two of the four categories carry directives rather than data: a
 * recipe's `instructions` and an app rule's `polishInstructions` both reach the
 * slot that tells the model what to do, and an app rule reaches it automatically,
 * over every dictation into a matched app, pasting the result at the cursor. So
 * neither arrives with the standing the person's own writing has. Both are
 * created untrusted, which demotes their text out of the directive slot into a
 * delimited block the fixed rules outrank (`build-system-prompt.ts`). Snippets
 * need nothing: a snippet is literal replacement text and reaches no model.
 *
 * App rules are created disabled on top of that, because they are the only ones
 * that run without being asked: a matched rule reshapes every dictation into
 * its app and pastes the result at the cursor. Two facts, not one. `enabled`
 * decides whether the rule runs at all; `trusted` decides what its directive is
 * allowed to be once it does. Turning a rule on is not the same act as vouching
 * for the words inside it, so it does not grant the second.
 *
 * See `specs/20260830T130918-settings-import-export.md`.
 */
import { nanoid } from 'nanoid/non-secure';
import { Err, Ok, type Result } from 'wellcrafted/result';
import type { TironianSettingValues } from '../workspace';
import type { TironianApp } from './app';
import {
	dedupeAppRulesAgainstExisting,
	validateAppRulesArray,
} from './app-rules-import';
import {
	dedupeRecipesAgainstExisting,
	validateRecipesArray,
} from './recipes-import';
import type {
	SettingsBundleFile,
	SettingsBundleSelection,
} from './settings-bundle-types';
import {
	PREFERENCE_CATEGORIES,
	PREFERENCE_CATEGORY_KEYS,
	type PreferenceCategory,
} from './settings-categories';
import {
	dedupeAgainstExisting,
	validateSnippetsArray,
} from './snippets-import';

export type SettingsBundleParseError =
	| { type: 'NotJson' }
	| { type: 'NotAnObject' }
	| { type: 'MissingVersion' }
	| { type: 'UnsupportedVersion'; version: unknown };

export function parseSettingsBundle(
	text: string,
): Result<SettingsBundleFile, SettingsBundleParseError> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return Err({ type: 'NotJson' });
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return Err({ type: 'NotAnObject' });
	}
	const { version } = parsed as Record<string, unknown>;
	if (version === undefined) return Err({ type: 'MissingVersion' });
	if (version !== 1) return Err({ type: 'UnsupportedVersion', version });
	return Ok(parsed as SettingsBundleFile);
}

/** Which categories a parsed file actually offers, for the import screen. */
export function availableCategoriesIn(file: SettingsBundleFile): {
	preferences: PreferenceCategory[];
	snippets: boolean;
	recipes: boolean;
	appRules: boolean;
} {
	return {
		preferences: PREFERENCE_CATEGORIES.filter(
			(category) => file.preferences?.[category] !== undefined,
		),
		snippets: Array.isArray(file.snippets),
		recipes: Array.isArray(file.recipes),
		appRules: Array.isArray(file.appRules),
	};
}

export type SettingsBundleImportSummary = {
	appliedPreferenceCategories: PreferenceCategory[];
	skippedFields: number;
	snippets?: { created: number; skippedDuplicate: number; rejected: number };
	recipes?: { created: number; skippedDuplicate: number; rejected: number };
	appRules?: { created: number; skippedDuplicate: number; rejected: number };
};

/**
 * A value is applied only when its runtime type matches the setting's own
 * current default. This catches ordinary corruption (a hand-edited file, a
 * mismatched version) without this feature re-declaring every field's exact
 * allowed domain a second time. It does not catch a wrong-but-same-typeof value
 * (an invalid `field.select` member that is still a string); that residual risk
 * is accepted, the same posture `transcriptionLanguage`'s own UI-only
 * validation already takes.
 */
function matchesDefaultShape(
	app: TironianApp,
	key: keyof TironianSettingValues,
	value: unknown,
): boolean {
	return typeof value === typeof app.settings.getDefault(key);
}

export function applySettingsBundle(
	app: TironianApp,
	file: SettingsBundleFile,
	selection: SettingsBundleSelection,
): SettingsBundleImportSummary {
	const appliedPreferenceCategories: PreferenceCategory[] = [];
	let skippedFields = 0;

	for (const category of selection.preferences) {
		const values = file.preferences?.[category];
		if (!values) continue;
		for (const key of PREFERENCE_CATEGORY_KEYS[category]) {
			if (!(key in values)) continue;
			const value = values[key];
			if (!matchesDefaultShape(app, key, value)) {
				skippedFields += 1;
				continue;
			}
			app.settings.set(key, value as never);
		}
		appliedPreferenceCategories.push(category);
	}

	const summary: SettingsBundleImportSummary = {
		appliedPreferenceCategories,
		skippedFields,
	};

	if (selection.snippets && file.snippets) {
		const validated = validateSnippetsArray(file.snippets);
		if (validated.data) {
			const { toCreate, skippedDuplicate } = dedupeAgainstExisting(
				validated.data.valid,
				app.snippets.all.map((row) => row.trigger),
			);
			for (const { trigger, replacement } of toCreate) {
				app.snippets.set({ id: nanoid(), trigger, replacement });
			}
			summary.snippets = {
				created: toCreate.length,
				skippedDuplicate,
				rejected: validated.data.rejected,
			};
		}
	}

	if (selection.recipes && file.recipes) {
		const validated = validateRecipesArray(file.recipes);
		if (validated.data) {
			const { toCreate, skippedDuplicate } = dedupeRecipesAgainstExisting(
				validated.data.valid,
				app.recipes.all.map((row) => row.name),
			);
			for (const { name, instructions, icon } of toCreate) {
				// Untrusted is written here rather than read from the file: a bundle
				// that could certify its own recipes would be certifying itself.
				app.recipes.set({
					id: nanoid(),
					name,
					instructions,
					icon,
					trusted: false,
				});
			}
			summary.recipes = {
				created: toCreate.length,
				skippedDuplicate,
				rejected: validated.data.rejected,
			};
		}
	}

	if (selection.appRules && file.appRules) {
		const validated = validateAppRulesArray(file.appRules);
		if (validated.data) {
			const { toCreate, skippedDuplicate } = dedupeAppRulesAgainstExisting(
				validated.data.valid,
				app.appRules.all,
			);
			for (const rule of toCreate) {
				// Both written here rather than read from the file, for the reason a
				// self-certifying bundle would not be worth much: off, because an
				// imported rule owns the automatic path once it is on, and untrusted,
				// because its directive is somebody else's words either way.
				app.appRules.set({
					id: nanoid(),
					...rule,
					enabled: false,
					trusted: false,
				});
			}
			summary.appRules = {
				created: toCreate.length,
				skippedDuplicate,
				rejected: validated.data.rejected,
			};
		}
	}

	return summary;
}
