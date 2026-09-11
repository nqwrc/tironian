<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { pageTitle } from '$lib/constants/brand';
	import { Button } from '@tironian/ui/button';
	import * as Empty from '@tironian/ui/empty';
	import { page } from '$app/state';
	import { whisperingPath } from '$lib/constants/urls';
</script>

<svelte:head>
	<title>{pageTitle(page.status === 404 ? 'Page Not Found' : 'Error')}</title>
</svelte:head>

<Empty.Root class="flex-1 p-8">
	<Empty.Header>
		<Empty.Title class="text-4xl font-bold text-foreground">
			{#if page.status === 404}
				404 - Page Not Found
			{:else}
				Something Went Wrong
			{/if}
		</Empty.Title>
		<Empty.Description class="text-lg">
			{#if page.status === 404}
				The page you're looking for doesn't exist.
			{:else}
				An unexpected error occurred.
			{/if}
		</Empty.Description>
	</Empty.Header>
	<Empty.Content> <Button href={whisperingPath('/')}>{m.app_go_home()}</Button> </Empty.Content>
</Empty.Root>
