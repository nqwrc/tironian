<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import * as Field from '@tironian/ui/field';
	import { Input } from '@tironian/ui/input';
	import * as Select from '@tironian/ui/select';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import {
		hasModelSelect,
		INFERENCE,
		INFERENCE_PROVIDER_OPTIONS,
		type InferenceProviderId,
	} from '$lib/constants/inference';
	import { resolveCompletionState } from '$lib/operations/completion';
	import { describeCompletionReadiness } from '$lib/operations/completion-target';
	import AdvancedDisclosure from './AdvancedDisclosure.svelte';
	import ProviderConfigFields, {
		hasOptionalFields,
	} from './ProviderConfigFields.svelte';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();

	// The Text stage of the capture pipeline: the AI destination Polish and every
	// Recipe send transcript text to. This surface owns the routing decision
	// (`completionProvider`/`completionModel`), with the selected provider's
	// credentials nested underneath as an implementation detail. Locality and
	// readiness are read from the same resolved state the call path uses, so what
	// the user sees here is exactly what the pipeline will do. One row picks the
	// provider (Vivavoce 4d); the key it needs sits under it, and the model and
	// endpoint overrides wait under Advanced.

	const provider = $derived(app.settings.get('completionProvider'));
	const readiness = $derived(
		describeCompletionReadiness(provider, resolveCompletionState(app)),
	);

	// Fixed-list providers offer a model picker; free-form ones (OpenRouter,
	// Custom) take a typed model id.
	const modelItems = $derived(
		hasModelSelect(provider)
			? INFERENCE[provider].models.map((model) => ({
					value: model,
					label: model,
				}))
			: null,
	);

	function selectProvider(next: InferenceProviderId) {
		app.settings.set('completionProvider', next);
		// A model id from the previous provider would 404 the next completion.
		// Default fixed-list providers to their first model; free-form providers
		// (OpenRouter, Custom) have `models: null` and keep whatever the user
		// typed. The `includes` cast widens off the per-provider tuple union (its
		// element type is `never`); `models[0]` stays typed as the tuple's first.
		const models = INFERENCE[next].models;
		if (
			models &&
			!(models as readonly string[]).includes(app.settings.get('completionModel'))
		) {
			app.settings.set('completionModel', models[0]);
		}
	}
</script>

<Field.Group class="gap-4">
	<Field.Field orientation="horizontal">
		<Field.Content>
			<Field.Label for="completion-provider">{m.completion_runtime_config_text_ai_provider()}</Field.Label>
			{#if readiness.ready}
				<Field.Description>{readiness.summary}</Field.Description>
			{:else}
				<Field.Description class="text-amber-600 dark:text-amber-400">
					<TriangleAlertIcon class="mr-1 inline size-3.5 align-[-2px]" />
					{readiness.summary}
				</Field.Description>
			{/if}
		</Field.Content>
		<Select.Root
			type="single"
			bind:value={() => provider,
				(value) => selectProvider(value as InferenceProviderId)}
		>
			<Select.Trigger id="completion-provider" size="sm" class="w-44 shrink-0">
				{INFERENCE[provider].label}
			</Select.Trigger>
			<Select.Content>
				{#each INFERENCE_PROVIDER_OPTIONS as option (option.value)}
					<Select.Item value={option.value} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>
	</Field.Field>

	<ProviderConfigFields {provider} part="required" />

	{#if !modelItems}
		<!-- Free-form providers (OpenRouter, Custom) have no default model, so the
		     id is a required primary input the endpoint must serve, kept inline. -->
		<Field.Field>
			<Field.Label for="completion-model">{m.completion_runtime_config_model()}</Field.Label>
			<Input
				id="completion-model"
				placeholder={m.completion_runtime_config_e_g_llama3_1()}
				autocomplete="off"
				value={app.settings.get('completionModel')}
				onblur={(e) => {
					const next = e.currentTarget.value;
					if (next !== app.settings.get('completionModel'))
						app.settings.set('completionModel', next);
				}}
			/>
			<Field.Description>
				{m.completion_runtime_config_the_model_id_your_endpoint()}
			</Field.Description>
		</Field.Field>
	{/if}

	{#if modelItems || hasOptionalFields(provider)}
		<!-- Fixed-list providers get a working default model on selection, so the
		     model is an advanced detail, like the endpoint overrides. -->
		<AdvancedDisclosure>
			<Field.Group>
				{#if modelItems}
					<Field.Field>
						<Field.Label for="completion-model">{m.completion_runtime_config_model()}</Field.Label>
						<Select.Root
							type="single"
							bind:value={() => app.settings.get('completionModel'),
								(value) => app.settings.set('completionModel', value)}
						>
							<Select.Trigger id="completion-model" class="w-full">
								{app.settings.get('completionModel') || 'Select a model'}
							</Select.Trigger>
							<Select.Content>
								{#each modelItems as item (item.value)}
									<Select.Item value={item.value} label={item.label} />
								{/each}
							</Select.Content>
						</Select.Root>
						<Field.Description>
							{m.completion_runtime_config_the_model_polish_and()}
						</Field.Description>
					</Field.Field>
				{/if}
				<ProviderConfigFields {provider} part="optional" />
			</Field.Group>
		</AdvancedDisclosure>
	{/if}
</Field.Group>
