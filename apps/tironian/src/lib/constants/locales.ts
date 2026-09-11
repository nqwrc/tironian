/**
 * The locales the interface ships messages for.
 *
 * Each label is written in its own language rather than translated, which is the
 * convention every language picker follows for the same reason: somebody looking
 * for Italian is looking for the word "Italiano", not for whatever the interface
 * they cannot currently read calls it.
 *
 * The list is deliberately hand-written next to the workspace field's union
 * rather than derived from Paraglide's compiled `locales`. That array is
 * generated output and carries no labels, and a locale that compiles is not the
 * same claim as a locale the app is willing to offer.
 */
export const INTERFACE_LOCALE_OPTIONS = [
	{ value: 'en', label: 'English' },
	{ value: 'it', label: 'Italiano' },
] as const satisfies readonly { value: 'en' | 'it'; label: string }[];
