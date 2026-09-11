<!--
	The settings groups, as a horizontal strip.

	This was a second left column beside the app rail, which meant two vertical
	menus on every settings screen. The rail is the app's only vertical
	navigation: it is icon-collapsed at medium widths and replaced by BottomNav
	below 768px, and a column that survives none of those transitions was
	competing with it rather than nesting under it.

	Five groups, not nine pages. Four of the old pages were under 80 lines, so
	they were a menu entry each for a handful of switches. Shortcuts sits second
	because it is the first thing a new person needs and the only home of the
	global hotkey.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import { cn } from '@tironian/ui/utils';
	import { cubicInOut } from 'svelte/easing';
	import { crossfade } from 'svelte/transition';
	import { page } from '$app/state';
	import { whisperingPath } from '$lib/constants/urls';

	const items = [
		{ title: 'Capture', href: whisperingPath('/settings') },
		{
			title: 'Shortcuts',
			href: whisperingPath('/settings/shortcuts'),
			activePathPrefix: whisperingPath('/settings/shortcuts'),
		},
		{
			title: m.settings_title_processing(),
			href: whisperingPath('/settings/processing'),
		},
		{ title: m.page_title_app_rules(), href: whisperingPath('/settings/apps') },
		{ title: m.group_nav_account_data(), href: whisperingPath('/settings/account') },
	] satisfies {
		title: string;
		href: string;
		/**
		 * If provided, the item is considered active if the current pathname starts with this prefix.
		 * Otherwise, it is considered active if the current pathname is exactly equal to the item's href.
		 */
		activePathPrefix?: string;
	}[];

	const [send, receive] = crossfade({
		duration: 250,
		easing: cubicInOut,
	});
</script>

<nav
	class="border-border/40 -mx-1 flex gap-1 overflow-x-auto border-b px-1 pb-2"
	aria-label={m.group_nav_settings_navigation()}
>
	{#each items as item (item.href)}
		{@const isActive = item.activePathPrefix
			? page.url.pathname.startsWith(item.activePathPrefix)
			: page.url.pathname === item.href}

		<Button
			href={item.href}
			variant="ghost"
			size="sm"
			class={cn(
				'relative shrink-0 font-normal transition-colors',
				isActive
					? 'text-sidebar-accent-foreground hover:bg-sidebar-accent/50'
					: 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
			)}
			aria-current={isActive ? 'page' : undefined}
			data-sveltekit-noscroll
		>
			{#if isActive}
				<div
					class="bg-sidebar-accent absolute inset-0 rounded-md"
					in:send={{ key: 'active-settings-group' }}
					out:receive={{ key: 'active-settings-group' }}
				></div>
			{/if}
			<span class="relative z-10">{item.title}</span>
		</Button>
	{/each}
</nav>
