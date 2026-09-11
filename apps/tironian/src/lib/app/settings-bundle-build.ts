/**
 * Shapes a settings bundle from what the person checked.
 *
 * Pure, and parameterized on `exportedAt` so it is deterministic under test.
 * The download half lives in `settings-bundle-export.ts`: that one reaches the
 * platform download seam, which drags the Tauri filesystem plugins in with it
 * and cannot be imported by a `bun test` file.
 *
 * See `specs/20260830T130918-settings-import-export.md`.
 */

import { isBuiltinRecipeId } from '../state/builtin-recipes';
import type { TironianSettingValues } from '../workspace';
import type { TironianApp } from './app';
import type {
	SettingsBundleFile,
	SettingsBundleSelection,
} from './settings-bundle-types';
import { PREFERENCE_CATEGORY_KEYS } from './settings-categories';

export function buildSettingsBundle(
	app: TironianApp,
	selection: SettingsBundleSelection,
	exportedAt: string,
): SettingsBundleFile {
	const preferences: SettingsBundleFile['preferences'] = {};
	for (const category of selection.preferences) {
		const values: Record<string, unknown> = {};
		for (const key of PREFERENCE_CATEGORY_KEYS[category]) {
			values[key] = app.settings.get(key as keyof TironianSettingValues);
		}
		preferences[category] = values;
	}

	const bundle: SettingsBundleFile = { version: 1, exportedAt, preferences };
	// Ids are minted per row (ADR-0206) and not portable, so they never travel.
	if (selection.snippets) {
		bundle.snippets = app.snippets.all.map(({ trigger, replacement }) => ({
			trigger,
			replacement,
		}));
	}
	if (selection.recipes) {
		bundle.recipes = app.recipes.all.map(({ name, instructions, icon }) => ({
			name,
			instructions,
			icon,
		}));
	}
	if (selection.appRules) {
		bundle.appRules = app.appRules.all.map(
			({
				name,
				matchWindowsExe,
				matchMacosBundleId,
				polishInstructions,
				recipeId,
				enabled,
			}) => ({
				name,
				matchWindowsExe,
				matchMacosBundleId,
				polishInstructions,
				// A user recipe's minted id names nothing on another device, so
				// only built-in references travel (see SettingsBundleFile).
				recipeId:
					recipeId !== null && isBuiltinRecipeId(recipeId) ? recipeId : null,
				enabled,
			}),
		);
	}
	return bundle;
}

/** How many categories a built bundle actually carries. */
export function countBundleCategories(bundle: SettingsBundleFile): number {
	return (
		Object.keys(bundle.preferences).length +
		(bundle.snippets ? 1 : 0) +
		(bundle.recipes ? 1 : 0) +
		(bundle.appRules ? 1 : 0)
	);
}
