<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { PRODUCT_NAME } from '$lib/constants/brand';
	import * as Sidebar from '@tironian/ui/sidebar';
	import { useSidebar } from '@tironian/ui/sidebar';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { toggleMode } from 'mode-watcher';
	import { page } from '$app/state';
	import { getTironianApp } from '$lib/app/context';
	import { dictationStats } from '$lib/app/dictation-stats';
	import tironianMark from '$lib/assets/tironian-mark.png';
	import { NAV_ITEMS } from './nav-items';

	// The labeled sidebar of the Vivavoce shell (deliverable 4b), in Tironian's
	// own identity: destinations with names, then what dictation has been doing
	// lately, then Settings. It collapses to the icon rail like any sidebar.
	const sidebar = useSidebar();
	const app = getTironianApp();

	const destinations = NAV_ITEMS.filter((item) => !('footer' in item));
	const pinned = NAV_ITEMS.filter((item) => 'footer' in item);

	const stats = $derived(dictationStats(app.recordings.sorted));
	const isLocal = $derived(
		app.settings.get('transcriptionService') === 'local',
	);

	function seconds(ms: number): string {
		return `${(ms / 1000).toFixed(1)}s`;
	}
</script>

<Sidebar.Root collapsible="icon">
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg">
					{#snippet child({ props })}
						<button {...props} onclick={sidebar.toggle}>
							<div class="flex size-8 items-center justify-center">
								<img src={tironianMark} alt="" class="size-5" />
							</div>
							<span
								class="truncate text-[15px] font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
								>{PRODUCT_NAME}</span
							>
						</button>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each destinations as item}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={item.isActive(page.url.pathname)}>
								{#snippet child({ props })}
									{@const Icon = item.icon}
									<a href={item.href} {...props}>
										<Icon />
										<span>{item.label}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		<div
			class="flex flex-col gap-1 px-2 pb-2 font-mono text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden"
			role="group"
			aria-label={m.vertical_nav_stats()}
		>
			{#if stats.wordsPerMinute !== null}
				<div>
					<span class="font-medium tabular-nums text-sidebar-foreground"
						>{stats.wordsPerMinute}</span
					>
					{m.vertical_nav_stat_wpm()}
				</div>
			{/if}
			{#if stats.medianWaitMs !== null}
				<div>
					<span class="font-medium tabular-nums text-sidebar-foreground"
						>{seconds(stats.medianWaitMs)}</span
					>
					{m.vertical_nav_stat_wait()}
				</div>
			{/if}
			<div>
				<span
					class={isLocal
						? 'font-medium text-success'
						: 'font-medium text-sidebar-foreground'}
					>{isLocal ? m.vertical_nav_stat_local() : m.vertical_nav_stat_cloud()}</span
				>
				{m.vertical_nav_stat_route()}
			</div>
		</div>

		<Sidebar.Menu>
			{#each pinned as item}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton isActive={item.isActive(page.url.pathname)}>
						{#snippet child({ props })}
							{@const Icon = item.icon}
							<a href={item.href} {...props}>
								<Icon />
								<span>{item.label}</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
					<Sidebar.MenuAction
						onclick={toggleMode}
						title={m.vertical_nav_toggle_theme()}
					>
						<SunIcon class="rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
						<MoonIcon
							class="absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
						/>
						<span class="sr-only">{m.vertical_nav_toggle_theme()}</span>
					</Sidebar.MenuAction>
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.Footer>

	<Sidebar.Rail />
</Sidebar.Root>
