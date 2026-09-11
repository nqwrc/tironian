<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { PRODUCT_NAME } from '$lib/constants/brand';
	import * as Sidebar from '@tironian/ui/sidebar';
	import { useSidebar } from '@tironian/ui/sidebar';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { toggleMode } from 'mode-watcher';
	import { page } from '$app/state';
	import { GithubIcon } from '$lib/components/icons';
	import tironianMark from '$lib/assets/tironian-mark.png';
	import { NAV_ITEMS } from './nav-items';

	const sidebar = useSidebar();
</script>

<Sidebar.Root collapsible="icon">
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton
					size="lg"
					class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
				>
					{#snippet child({ props })}
						<button {...props} onclick={sidebar.toggle}>
							<div
								class="bg-sidebar-accent flex size-8 items-center justify-center rounded-lg"
							>
								<img src={tironianMark} alt="" class="size-4" />
							</div>
							<div
								class="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden"
							>
								<span class="truncate font-semibold">{PRODUCT_NAME}</span>
								<span class="truncate text-xs text-muted-foreground"
									>{m.vertical_nav_speech_to_text()}</span
								>
							</div>
						</button>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>

	<Sidebar.Content>
		<!-- Navigation Group -->
		<Sidebar.Group>
			<Sidebar.GroupLabel>{m.vertical_nav_navigation()}</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each NAV_ITEMS as item}
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
		<Sidebar.Menu>
			<!-- Toggle dark mode -->
			<Sidebar.MenuItem>
				<Sidebar.MenuButton>
					{#snippet child({ props })}
						<button onclick={toggleMode} {...props}>
							<SunIcon
								class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
							/>
							<MoonIcon
								class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
							/>
							<span>{m.vertical_nav_toggle_theme()}</span>
						</button>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>

			<!-- GitHub link -->
			<Sidebar.MenuItem>
				<Sidebar.MenuButton>
					{#snippet child({ props })}
						<a
							href="https://github.com/nqwrc/tironian"
							target="_blank"
							rel="noopener noreferrer"
							{...props}
						>
							<GithubIcon />
							<span>GitHub</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>

	<Sidebar.Rail />
</Sidebar.Root>
