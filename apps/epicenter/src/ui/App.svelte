<script lang="ts">
	import Settings from './Settings.svelte';

	/**
	 * Epicenter Home is the model administration window and nothing else
	 * (ADR-0180): the one place a local transcription model is chosen,
	 * downloaded, or deleted. A single-app product has no launcher and no chat
	 * to hold beside it, so this shell renders Settings directly rather than
	 * switching between panes.
	 */
</script>

<div class="h-full overflow-y-auto">
	<Settings />
</div>
