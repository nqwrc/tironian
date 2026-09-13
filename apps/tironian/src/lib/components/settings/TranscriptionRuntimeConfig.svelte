<script lang="ts">
	import { PRODUCT_NAME } from '$lib/constants/brand';
	import { m } from '$lib/paraglide/messages';
	import { Badge } from '@tironian/ui/badge';
	import { Button } from '@tironian/ui/button';
	import { CopyButton } from '@tironian/ui/copy-button';
	import * as Field from '@tironian/ui/field';
	import { Input } from '@tironian/ui/input';
	import { Link } from '@tironian/ui/link';
	import * as Select from '@tironian/ui/select';
	import { Textarea } from '@tironian/ui/textarea';
	import { cn } from '@tironian/ui/utils';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import CopyablePre from '$lib/components/copyable/CopyablePre.svelte';
	import {
		SUPPORTED_LANGUAGES_OPTIONS,
		type SupportedLanguage,
	} from '$lib/constants/languages';
	import { describeTranscriptionDestinationFromConfig } from '$lib/operations/transcription-target';
	import {
		ACCESS_GROUPS,
		TRANSCRIPTION_PROVIDERS,
		type TranscriptionProviderEntry,
	} from '$lib/services/transcription/provider-ui';
	import {
		PROVIDERS,
		type ProviderAccess,
		type TranscriptionServiceId,
	} from '$lib/services/transcription/providers';
	import { deviceConfig } from '$lib/state/device-config.svelte';
	import {
		getLocalRouteBlocker,
		getTranscriptionReadiness,
		isTranscriptionServiceAvailable,
		isTranscriptionServiceConfigured,
	} from '$lib/settings/transcription-validation';
	import { localRoute } from '$lib/state/local-route.svelte';
	import { createCopyFn } from '$lib/utils/createCopyFn';
	import AdvancedDisclosure from './AdvancedDisclosure.svelte';
	import LocalModelAdministration from './LocalModelAdministration.svelte';
	import ProviderConfigFields from './ProviderConfigFields.svelte';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();

	// The Audio stage of the capture pipeline, one provider at a time. The select
	// chooses whose setup shows underneath (its key and model, its local model,
	// or its server), opening on the route in use. Showing every provider's card
	// at once made the page a catalog to scroll past.
	//
	// Browsing is not switching: the select never writes `transcriptionService`.
	// Adding an OpenAI key while dictating through Groq must not point capture at
	// a provider that has no key yet, so the route changes only through the
	// explicit "Use" button, offered once the shown provider is configured (the
	// same bar the recorder switcher on Home applies). Like
	// {@link CompletionRuntimeConfig}, it takes no props.

	const activeService = $derived(app.settings.get('transcriptionService'));

	/** The provider whose setup is shown; `null` follows the route in use. */
	let browsing = $state<TranscriptionServiceId | null>(null);
	const shownService = $derived(browsing ?? activeService);

	const selected = $derived(
		TRANSCRIPTION_PROVIDERS.find((entry) => entry.id === shownService),
	);
	const selectedConfigured = $derived(
		selected ? isTranscriptionServiceConfigured(selected) : false,
	);

	function useShown() {
		app.settings.set('transcriptionService', shownService);
		browsing = null;
	}

	const destination = $derived(
		describeTranscriptionDestinationFromConfig({
			service: activeService,
			getDeviceConfig: deviceConfig.get,
		}),
	);
	const readiness = $derived(getTranscriptionReadiness(app));

	// `undefined` while the first host read is in flight, which is neither ready
	// nor blocked and must not flash a warning.
	const localRouteChecked = $derived(localRoute.result !== undefined);
	const localRouteBlocker = $derived(getLocalRouteBlocker());

	// Cloud/self-hosted capability is provider-wide (static). Local capability is
	// per-model, read from the host's active model; the runtime independently
	// guards what it applies and reports it back. Gates the advanced fields.
	const currentServiceCapabilities = $derived(
		activeService === 'local'
			? localRoute.capabilities
			: PROVIDERS[activeService].capabilities,
	);

	const spokenLanguageLabel = $derived(
		SUPPORTED_LANGUAGES_OPTIONS.find(
			(i) => i.value === app.settings.get('transcriptionLanguage'),
		)?.label,
	);

	// The picker's groups, in the presentation SSOT's order. On-device transcribes
	// through Rust, so it is offered only on desktop (matching the readiness check).
	const groups = (
		Object.entries(ACCESS_GROUPS) as [
			ProviderAccess,
			(typeof ACCESS_GROUPS)[ProviderAccess],
		][]
	)
		.map(([access, meta]) => ({
			access,
			heading: meta.heading,
			entries: TRANSCRIPTION_PROVIDERS.filter(
				(entry) =>
					entry.access === access && isTranscriptionServiceAvailable(entry),
			),
		}))
		.filter((group) => group.entries.length > 0);
</script>

{#snippet renderServiceIcon(entry: TranscriptionProviderEntry)}
	<div
		class={cn(
			'size-4 shrink-0 flex items-center justify-center [&>svg]:size-full',
			entry.invertInDarkMode && 'dark:[&>svg]:invert dark:[&>svg]:brightness-90',
		)}
	>
		{@html entry.icon}
	</div>
{/snippet}

<Field.Group class="gap-4">
	<Field.Field orientation="horizontal">
		<Field.Content>
			<Field.Label for="transcription-route">
				{m.transcription_runtime_config_provider()}
			</Field.Label>
			{#if readiness.isReady}
				<Field.Description>{destination.summary}</Field.Description>
			{:else}
				<Field.Description class="text-amber-600 dark:text-amber-400">
					<TriangleAlertIcon class="mr-1 inline size-3.5 align-[-2px]" />
					{readiness.primaryIssue}
				</Field.Description>
			{/if}
		</Field.Content>
		<Select.Root
			type="single"
			bind:value={
				() => shownService,
				(value) => {
					browsing = value as TranscriptionServiceId;
				}
			}
		>
			<Select.Trigger id="transcription-route" size="sm" class="w-44 shrink-0">
				{#if selected}
					<span class="flex items-center gap-2">
						{@render renderServiceIcon(selected)}
						{selected.label}
					</span>
				{/if}
			</Select.Trigger>
			<Select.Content>
				{#each groups as group (group.access)}
					<Select.Group>
						<Select.GroupHeading>{group.heading}</Select.GroupHeading>
						{#each group.entries as entry (entry.id)}
							<Select.Item value={entry.id} label={entry.label}>
								<span class="flex items-center gap-2">
									{@render renderServiceIcon(entry)}
									{entry.label}
									{#if entry.id === activeService}
										<span class="text-voce text-xs">
											{m.transcription_runtime_config_active()}
										</span>
									{:else if !isTranscriptionServiceConfigured(entry)}
										<span class="text-muted-foreground text-xs">
											{m.transcription_runtime_config_needs_setup()}
										</span>
									{/if}
								</span>
							</Select.Item>
						{/each}
					</Select.Group>
				{/each}
			</Select.Content>
		</Select.Root>
	</Field.Field>

	{#if selected && shownService !== activeService}
		<div
			class="bg-muted/50 flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm"
		>
			<span class="text-muted-foreground">
				{selectedConfigured
					? m.transcription_runtime_config_not_in_use()
					: m.transcription_runtime_config_finish_setup_to_use()}
			</span>
			<Button size="sm" disabled={!selectedConfigured} onclick={useShown}>
				{m.transcription_runtime_config_use_provider({ provider: selected.label })}
			</Button>
		</div>
	{/if}

	{#if selected?.access === 'onDevice'}
		{@render onDeviceSection()}
	{:else if selected?.access === 'key'}
		{@render keyProviderFields(selected)}
	{:else if selected?.access === 'endpoint'}
		{@render speachesSection()}
	{/if}

	<AdvancedDisclosure>
		<Field.Group>{@render advancedFields()}</Field.Group>
	</AdvancedDisclosure>
</Field.Group>

{#snippet onDeviceSection()}
	<!-- The one active local model is administered here, in the app's own
	     Settings (ADR-0245): chosen, downloaded, deleted, and unloaded when idle. -->
	{#if localRouteChecked && !localRouteBlocker}
		<div>
			<Badge variant="secondary" class="text-xs">{m.transcription_runtime_config_ready()}</Badge>
		</div>
	{/if}
	<LocalModelAdministration />
{/snippet}

{#snippet keyProviderFields(entry: Extract<TranscriptionProviderEntry, { access: 'key' }>)}
	{@const modelItems = entry.models.map((model) => ({
		value: model.name,
		label: model.name,
		...model,
	}))}
	<ProviderConfigFields provider={entry.id} />

	<Field.Field orientation="horizontal">
		<Field.Content>
			<Field.Label for="{entry.id}-model">{m.completion_runtime_config_model()}</Field.Label>
			{#if entry.modelsDoc}
				<Field.Description>
					<Link href={entry.modelsDoc.href} target="_blank" rel="noopener noreferrer">
						{entry.modelsDoc.label}
					</Link>
				</Field.Description>
			{/if}
		</Field.Content>
		<Select.Root
			type="single"
			bind:value={
				() => app.settings.get(entry.modelSettingKey),
				(v) => app.settings.set(entry.modelSettingKey, v)
			}
		>
			<Select.Trigger id="{entry.id}-model" size="sm" class="w-44 shrink-0">
				{modelItems.find(
					(item) => item.value === app.settings.get(entry.modelSettingKey),
				)?.label ?? 'Select a model'}
			</Select.Trigger>
			<Select.Content>
				{#each modelItems as item}
					<Select.Item value={item.value} label={item.label}>
						<div class="flex flex-col gap-1 py-1">
							<div class="font-medium">{item.name}</div>
							<div class="text-sm text-muted-foreground">
								{item.description}
							</div>
							<Badge variant="outline" class="text-xs">{item.cost}</Badge>
						</div>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</Field.Field>
{/snippet}

{#snippet speachesSection()}
	<Field.Field>
		<Field.Label for="speaches-base-url">{m.transcription_runtime_config_base_url()}</Field.Label>
		<Input
			id="speaches-base-url"
			placeholder="http://localhost:8000"
			autocomplete="off"
			bind:value={
				() => deviceConfig.get('providers.speaches.endpoint'),
				(value) => deviceConfig.set('providers.speaches.endpoint', value)
			}
		/>
	</Field.Field>

	<Field.Field>
		<Field.Label for="speaches-model-id">{m.transcription_runtime_config_model_id()}</Field.Label>
		<Input
			id="speaches-model-id"
			placeholder="Systran/faster-distil-whisper-small.en"
			autocomplete="off"
			bind:value={
				() => deviceConfig.get('providers.speaches.modelId'),
				(value) => deviceConfig.set('providers.speaches.modelId', value)
			}
		/>
	</Field.Field>

	<!-- The install walkthrough is for the first visit only; once the server
	     answers, the two fields above are all this route needs. -->
	<AdvancedDisclosure label={m.transcription_runtime_config_setup_guide()}>
		<div class="space-y-4 text-sm">
			<p class="text-muted-foreground">
				{m.transcription_runtime_config_install_speaches_server({ productName: PRODUCT_NAME })}
			</p>
			<div class="flex gap-3">
				<Button
					size="sm"
					href="https://speaches.ai/installation/"
					target="_blank"
					rel="noopener noreferrer"
				>
					{m.transcription_runtime_config_installation_guide()}
				</Button>
				<Button
					size="sm"
					variant="outline"
					href="https://speaches.ai/usage/speech-to-text/"
					target="_blank"
					rel="noopener noreferrer"
				>
					{m.transcription_runtime_config_speech_to_text_guide()}
				</Button>
			</div>

			<div>
				<p class="font-medium">
					<span class="text-muted-foreground">{m.transcription_runtime_config_step_1()}</span>
					{m.transcription_runtime_config_install_speaches_server_2()}
				</p>
				<ul class="ml-6 mt-2 space-y-2 text-muted-foreground">
					<li class="list-disc">
						{m.transcription_runtime_config_download_the_necessary()} <Link
							href="https://speaches.ai/installation/"
							target="_blank"
							rel="noopener noreferrer"
						>
							{m.transcription_runtime_config_installation_guide_2()}
						</Link>
					</li>
					<li class="list-disc">
						{m.transcription_runtime_config_choose_cuda_cuda_with()}
					</li>
				</ul>
			</div>

			<div>
				<p class="font-medium mb-2">
					<span class="text-muted-foreground">{m.transcription_runtime_config_step_2()}</span>
					{m.transcription_runtime_config_start_speaches_container()}
				</p>
				<CopyablePre copyableText="docker compose up --detach" variant="code" />
			</div>

			<div>
				<p class="font-medium">
					<span class="text-muted-foreground">{m.transcription_runtime_config_step_3()}</span>
					{m.transcription_runtime_config_download_a_speech()}
				</p>
				<ul class="ml-6 mt-2 space-y-2 text-muted-foreground">
					<li class="list-disc">
						{m.transcription_runtime_config_view_available_models_in()} <Link
							href="https://speaches.ai/usage/speech-to-text/"
							target="_blank"
							rel="noopener noreferrer"
						>
							{m.transcription_runtime_config_speech_to_text_guide_2()}
						</Link>
					</li>
					<li class="list-disc">
						{m.transcription_runtime_config_run_the_following()}
					</li>
				</ul>
				<div class="mt-2">
					<CopyablePre
						copyableText="uvx speaches-cli model download Systran/faster-distil-whisper-small.en"
						variant="code"
					/>
				</div>
			</div>

			<div>
				<p class="font-medium">
					<span class="text-muted-foreground">{m.transcription_runtime_config_step_4()}</span>
					{m.transcription_runtime_config_configure_the_settings()}
				</p>
				<p class="text-muted-foreground mt-2">
					{m.transcription_runtime_config_the_url_where_your()}<code>SPEACHES_BASE_URL</code
					>{m.transcription_runtime_config_typically()}
					<CopyButton
						text="http://localhost:8000"
						copyFn={createCopyFn('speaches base url')}
						class="bg-muted rounded px-[0.3rem] py-[0.15rem] font-mono text-sm hover:bg-muted/80"
						variant="ghost"
						size="sm"
					>
						http://localhost:8000
					</CopyButton>
				</p>
				<p class="text-muted-foreground mt-2">
					{m.transcription_runtime_config_the_model_you_downloaded()}<code>MODEL_ID</code>), e.g.
					<CopyButton
						text="Systran/faster-distil-whisper-small.en"
						copyFn={createCopyFn('speaches model id')}
						class="bg-muted rounded px-[0.3rem] py-[0.15rem] font-mono text-sm hover:bg-muted/80"
						variant="ghost"
						size="sm"
					>
						Systran/faster-distil-whisper-small.en
					</CopyButton>
				</p>
			</div>
		</div>
	</AdvancedDisclosure>
{/snippet}

{#snippet advancedFields()}
	<Field.Field>
		<Field.Label for="spoken-language">{m.transcription_runtime_config_spoken_language()}</Field.Label>
		<Select.Root
			type="single"
			bind:value={
				() => app.settings.get('transcriptionLanguage'),
				(v) => app.settings.set('transcriptionLanguage', v as SupportedLanguage)
			}
			disabled={!currentServiceCapabilities.supportsLanguage}
		>
			<Select.Trigger id="spoken-language" class="w-full">
				{spokenLanguageLabel ?? 'Select a spoken language'}
			</Select.Trigger>
			<Select.Content>
				{#each SUPPORTED_LANGUAGES_OPTIONS as item}
					<Select.Item value={item.value} label={item.label} />
				{/each}
			</Select.Content>
		</Select.Root>
		{#if !currentServiceCapabilities.supportsLanguage}
			<Field.Description>
				{m.transcription_runtime_config_this_model_detects_the()}
			</Field.Description>
		{:else}
			<Field.Description>
				{m.transcription_runtime_config_auto_lets_the_provider()}
			</Field.Description>
		{/if}
	</Field.Field>

	<Field.Field>
		<Field.Label for="transcription-prompt">{m.transcription_runtime_config_system_prompt()}</Field.Label>
		<Textarea
			id="transcription-prompt"
			placeholder={m.transcription_runtime_config_e_g_this_is_an_academic()}
			disabled={!currentServiceCapabilities.supportsPrompt}
			value={app.settings.get('transcriptionPrompt')}
			onblur={(e) => {
				const next = e.currentTarget.value;
				if (next !== app.settings.get('transcriptionPrompt'))
					app.settings.set('transcriptionPrompt', next);
			}}
		/>
		<Field.Description>
			{currentServiceCapabilities.supportsPrompt
				? 'Helps services that support prompts recognize specific terms, names, or context during transcription. For rewriting or translation, use Recipes.'
				: 'This transcription service does not support prompts.'}
		</Field.Description>
	</Field.Field>
{/snippet}
