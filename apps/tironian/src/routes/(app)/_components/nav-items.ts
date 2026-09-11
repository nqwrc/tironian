import HomeIcon from '@lucide/svelte/icons/house';
import LayersIcon from '@lucide/svelte/icons/layers';
import ListIcon from '@lucide/svelte/icons/list';
import ReplaceIcon from '@lucide/svelte/icons/replace';
import SettingsIcon from '@lucide/svelte/icons/settings';
import SpeechIcon from '@lucide/svelte/icons/speech';
import type { Component } from 'svelte';
import { DICTATION_BASE_PATHNAME, dictationPath } from '$lib/constants/urls';

export type NavItem = {
	label: string;
	href: string;
	icon: Component;
	isActive: (pathname: string) => boolean;
};

/** Matches a route and all its sub-routes (e.g., `/settings` matches `/settings/audio`). */
const matchesRoute = (href: string) => (pathname: string) =>
	pathname === href || pathname.startsWith(`${href}/`);

/**
 * Primary navigation items shared across sidebar and bottom bar layouts.
 *
 * Add new top-level routes here: both `VerticalNav` and `BottomNav` consume
 * this array, so changes propagate automatically.
 */
export const NAV_ITEMS = [
	{
		label: 'Home',
		href: dictationPath('/'),
		icon: HomeIcon,
		isActive: (pathname) =>
			pathname === DICTATION_BASE_PATHNAME || pathname === dictationPath('/'),
	},
	{
		label: 'Recordings',
		href: dictationPath('/recordings'),
		icon: ListIcon,
		isActive: matchesRoute(dictationPath('/recordings')),
	},
	{
		label: 'Dictation',
		href: dictationPath('/dictation'),
		icon: SpeechIcon,
		isActive: matchesRoute(dictationPath('/dictation')),
	},
	{
		label: 'Recipes',
		href: dictationPath('/recipes'),
		icon: LayersIcon,
		isActive: matchesRoute(dictationPath('/recipes')),
	},
	{
		label: 'Snippets',
		href: dictationPath('/snippets'),
		icon: ReplaceIcon,
		isActive: matchesRoute(dictationPath('/snippets')),
	},
	{
		label: 'Settings',
		href: dictationPath('/settings'),
		icon: SettingsIcon,
		isActive: matchesRoute(dictationPath('/settings')),
	},
] as const satisfies readonly NavItem[];
