import { nanoid } from 'nanoid/non-secure';
import type { Snippet } from '$lib/workspace';

export function generateDefaultSnippet(): Snippet {
	return { id: nanoid(), trigger: '', replacement: '' };
}
