<script lang="ts">
	import { Checkbox } from '@tironian/ui/checkbox';
	import { Label } from '@tironian/ui/label';

	// One list, used for both directions: on export it offers everything this
	// install has, on import only what the chosen file carries. The two differ
	// in what they are handed, not in how they behave.
	let {
		idPrefix,
		items,
		selected = $bindable(),
	}: {
		/** Keeps the export and import lists' input ids apart on one page. */
		idPrefix: string;
		items: { key: string; label: string }[];
		selected: Set<string>;
	} = $props();

	function toggle(key: string, checked: boolean) {
		// A new Set rather than a mutation: `$state` tracks the reference.
		const next = new Set(selected);
		if (checked) next.add(key);
		else next.delete(key);
		selected = next;
	}
</script>

<ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
	{#each items as item (item.key)}
		{@const id = `${idPrefix}-${item.key}`}
		<li class="flex items-center gap-2">
			<Checkbox
				{id}
				checked={selected.has(item.key)}
				onCheckedChange={(checked) => toggle(item.key, checked === true)}
			/>
			<Label for={id} class="text-sm font-normal">{item.label}</Label>
		</li>
	{/each}
</ul>
