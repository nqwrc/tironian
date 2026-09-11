import { nanoid } from 'nanoid/non-secure';
import type { AppRule } from '$lib/workspace';

/**
 * A blank rule for the editor. Trusted on the way out: the person is about to
 * write the directive themselves, which is the whole of what trust means here.
 */
export function generateDefaultAppRule(): AppRule {
	return {
		id: nanoid(),
		name: '',
		matchWindowsExe: null,
		matchMacosBundleId: null,
		polishInstructions: null,
		recipeId: null,
		enabled: true,
		trusted: true,
	};
}
