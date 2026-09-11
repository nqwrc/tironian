import { onMount } from 'svelte';
import type { TironianApp } from '$lib/app/app';
import { dispatchCommandTrigger } from '$lib/commands';
import { services } from '$lib/services';

/**
 * Subscribe the in-app keydown matcher to the command layer for the app's
 * lifetime. The bindings it matches are pushed by `synchronizeShortcuts`.
 */
export function listenForLocalShortcuts(app: TironianApp): void {
	onMount(() => {
		const unlisten = services.localShortcutManager.listen((commandId, state) =>
			dispatchCommandTrigger(app, commandId, state),
		);
		return () => unlisten();
	});
}
