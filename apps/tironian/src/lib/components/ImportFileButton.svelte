<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import FileUpIcon from '@lucide/svelte/icons/file-up';
	import { IMPORT_ACCEPT } from '$lib/constants/import-formats';
	import { importFiles } from '$lib/operations/import';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();

	let { class: className }: { class?: string } = $props();

	// The picker is the hidden native <input type="file">; the visible button
	// just opens it, so it can match the header's other ghost icon buttons.
	let fileInput = $state<HTMLInputElement>();

	async function onchange(
		event: Event & { currentTarget: HTMLInputElement },
	) {
		const files = Array.from(event.currentTarget.files ?? []);
		// Reset so picking the same file again still fires `change`.
		event.currentTarget.value = '';
		if (files.length > 0) await importFiles(app, { files });
	}
</script>

<Button
	tooltip={m.import_file_button_upload_an_audio_or_video_file()}
	onclick={() => fileInput?.click()}
	variant="ghost"
	size="icon"
	class={className}
>
	<FileUpIcon class="size-4" />
</Button>
<input
	bind:this={fileInput}
	type="file"
	accept={IMPORT_ACCEPT}
	multiple
	class="hidden"
	{onchange}
/>
