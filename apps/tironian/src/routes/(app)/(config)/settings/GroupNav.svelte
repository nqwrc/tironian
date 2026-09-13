<!--
	The settings groups, as tabs across the top of the page (Vivavoce 4d: one
	navigation, the sections become tabs at the head of the page).

	This was a second left column beside the app rail, which meant two vertical
	menus on every settings screen. The rail is the app's only vertical
	navigation, and a column that survives none of its breakpoints was competing
	with it rather than nesting under it.

	Five groups, not nine pages. Four of the old pages were under 80 lines, so
	they were a menu entry each for a handful of switches. Shortcuts comes first
	because it is the first thing a new person needs and the only home of the
	global hotkey. The design's separate Dictation and Sounds tabs are not here:
	Dictation is already a page of its own, and sounds live under Recording.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { cn } from '@tironian/ui/utils';
	import { page } from '$app/state';
	import { dictationPath } from '$lib/constants/urls';

	const items = [
		{
			title: 'Shortcuts',
			href: dictationPath('/settings/shortcuts'),
			activePathPrefix: dictationPath('/settings/shortcuts'),
		},
		{ title: m.group_nav_recording(), href: dictationPath('/settings') },
		{
			title: m.settings_title_processing(),
			href: dictationPath('/settings/processing'),
		},
		{ title: m.page_title_app_rules(), href: dictationPath('/settings/apps') },
		{ title: m.group_nav_account_data(), href: dictationPath('/settings/account') },
	] satisfies {
		title: string;
		href: string;
		/**
		 * If provided, the item is considered active if the current pathname starts with this prefix.
		 * Otherwise, it is considered active if the current pathname is exactly equal to the item's href.
		 */
		activePathPrefix?: string;
	}[];
</script>

<nav
	class="flex gap-1 overflow-x-auto border-b border-border/60 [scrollbar-width:none]"
	aria-label={m.group_nav_settings_navigation()}
>
	{#each items as item (item.href)}
		{@const isActive = item.activePathPrefix
			? page.url.pathname.startsWith(item.activePathPrefix)
			: page.url.pathname === item.href}

		<a
			href={item.href}
			class={cn(
				'-mb-px shrink-0 border-b-2 px-3 pt-1.5 pb-2.5 text-[13px] transition-colors duration-(--motion-micro) outline-none focus-visible:ring-2 focus-visible:ring-ring',
				isActive
					? 'border-voce font-medium text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground',
			)}
			aria-current={isActive ? 'page' : undefined}
			data-sveltekit-noscroll
		>
			{item.title}
		</a>
	{/each}
</nav>
