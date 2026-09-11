<script lang="ts">
	import { PRODUCT_NAME } from '$lib/constants/brand';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import { Card } from '@tironian/ui/card';
	import * as Field from '@tironian/ui/field';
	import { Input } from '@tironian/ui/input';
	import { Link } from '@tironian/ui/link';
	import * as SectionHeader from '@tironian/ui/section-header';
	import { Textarea } from '@tironian/ui/textarea';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import { AdvancedDisclosure, SettingSwitch } from '$lib/components/settings';
	import { dictationPath } from '$lib/constants/urls';
	import {
		buildTranscriptionPrompt,
		recognizerPromptCharBudget,
	} from '$lib/operations/build-transcription-prompt';
	import { polishDestination, polishStatus } from '$lib/operations/run-polish';
	import { PROVIDERS } from '$lib/services/transcription/providers';
	import { localRoute } from '$lib/state/local-route.svelte';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();

	// Null when the person has added no terms: the definition cannot default an array,
	// so "never touched" and "emptied" are the same empty list here.
	const dictionary = $derived(app.settings.get('dictionary') ?? []);
	// Whether the selected recognizer clips a long Dictionary, and where.
	//
	// The bound is Whisper's, so most of this page's job is refusing to warn: a
	// route with no Whisper ceiling gets a null budget, drops nothing, and shows
	// nothing. The two facts the budget function cannot see from a pure module are
	// resolved here. One is OpenAI's model, the only picker whose menu spans a
	// Whisper decoder and the `gpt-4o-transcribe` pair. The other is a local model
	// that accepts no prompt at all: the host strips the whole thing before
	// inference, so "everything from here down is missing" would understate it into
	// a falsehood, and the honest sentence for that case already lives beside the
	// disabled System Prompt field on the transcription settings page.
	//
	// Asking the same pair of functions the transcribe path runs is what keeps this
	// page from reporting a boundary the recognizer does not actually have.
	const service = $derived(app.settings.get('transcriptionService'));
	const promptBudget = $derived(
		service === 'local' && !localRoute.capabilities.supportsPrompt
			? null
			: recognizerPromptCharBudget(
					service,
					service === 'OpenAI'
						? app.settings.get(PROVIDERS.OpenAI.modelSettingKey)
						: null,
				),
	);
	const unreached = $derived(
		buildTranscriptionPrompt(
			app.settings.get('transcriptionPrompt'),
			dictionary,
			promptBudget,
		).dropped,
	);
	// The System Prompt shares the same budget and lives on another page, so it is
	// named as a cause and offered as a remedy only when the person actually has
	// one. It defaults to empty, which is where a Dictionary long enough to clip
	// most often finds itself.
	const systemPrompt = $derived(app.settings.get('transcriptionPrompt').trim());
	// Intent (`polishEnabled`) and capability (a usable provider) are separate
	// facts; the toggle below sets intent, this surfaces when intent is on but
	// the provider is missing so the control never silently reads "on" while the
	// pipeline ships raw.
	const polish = $derived(polishStatus(app));
	const destination = $derived(polishDestination(app));

	let newTerm = $state('');

	function addTerm() {
		const term = newTerm.trim();
		newTerm = '';
		// Injection-only and order-free, so dedupe and ignore blanks; a repeated
		// term would only bloat the prompt block.
		if (!term || dictionary.includes(term)) return;
		app.settings.set('dictionary', [...dictionary, term]);
	}

	function removeTerm(term: string) {
		app.settings.set(
			'dictionary',
			dictionary.filter((t) => t !== term),
		);
	}
</script>

<svelte:head> <title>{m.nav_dictation()}</title> </svelte:head>

<main class="mx-auto flex w-full flex-1 flex-col gap-2 px-4 py-4 sm:px-8">
	<SectionHeader.Root>
		<SectionHeader.Title
			level={1}
			class="scroll-m-20 text-4xl tracking-tight lg:text-5xl"
		>
			{m.nav_dictation()}
		</SectionHeader.Title>
		<SectionHeader.Description>
			{m.dictation_what_happens_to_your_words_between_the({ productName: PRODUCT_NAME })}
		</SectionHeader.Description>
	</SectionHeader.Root>

	<Card class="flex flex-col gap-4 p-6">
		<Field.Set>
			<Field.Legend variant="label">{m.dictation_polish()}</Field.Legend>
			<Field.Description>
				{m.dictation_an_always_on_ai_pass_that_fixes_grammar()}
			</Field.Description>
			<Field.Group>
				<SettingSwitch
					key="polishEnabled"
					label={m.dictation_polish_transcripts_with_ai()}
					description={m.dictation_turn_off_for_speed_mode_the_raw_transcript()}
				/>
				{#if app.settings.get('polishEnabled')}
					<p class="text-muted-foreground text-sm">{destination}</p>
				{/if}

				{#if polish === 'needs-key'}
					<div
						class="border-amber-500/30 bg-amber-500/10 text-foreground flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm"
					>
						<KeyRoundIcon class="mt-0.5 size-4 shrink-0 text-amber-500" />
						<p>
							{m.dictation_polish_is_on_but_the_completion_provider_is()} <Link
								href={dictationPath('/settings/processing')}
								>{m.dictation_check_completion_settings()}</Link
							> {m.dictation_to_start_cleaning_them_up()}
						</p>
					</div>
				{/if}

				{#if app.settings.get('polishEnabled')}
					<AdvancedDisclosure>
						<Field.Field>
							<Field.Label for="polish-instructions">
								{m.dictation_polish_instructions()}
							</Field.Label>
							<Textarea
								id="polish-instructions"
								placeholder={app.settings.getDefault('polishInstructions')}
								value={app.settings.get('polishInstructions')}
								onblur={(e) => {
									const next = e.currentTarget.value;
									if (next !== app.settings.get('polishInstructions'))
										app.settings.set('polishInstructions', next);
								}}
							/>
							<Field.Description>
								{m.dictation_what_polish_does_to_every_transcript_keep()}
							</Field.Description>
						</Field.Field>
					</AdvancedDisclosure>
				{/if}
			</Field.Group>
		</Field.Set>
	</Card>

	<Card class="flex flex-col gap-4 p-6">
		<Field.Set>
			<Field.Legend variant="label">{m.dictation_command_mode()}</Field.Legend>
			<Field.Description>
				{m.dictation_a_short_list_of_spoken_phrases_that_do()}
			</Field.Description>
			<Field.Group>
				<SettingSwitch
					key="commandModeEnabled"
					label={m.dictation_act_on_spoken_commands()}
					description={m.dictation_off_by_default_because_these_phrases_stop()}
				/>
				{#if app.settings.get('commandModeEnabled')}
					<ul class="text-muted-foreground space-y-1 text-sm">
						<li>
							<span class="text-foreground font-medium">{m.dictation_scratch_that()}</span>
							or
							<span class="text-foreground font-medium">{m.dictation_undo_that()}</span>
							{m.dictation_removes_what_was_just_typed_at_your_cursor()}
						</li>
						<li>
							<span class="text-foreground font-medium">{m.dictation_stop_listening()}</span>
							{m.dictation_ends_a_voice_activated_session()}
						</li>
					</ul>
				{/if}
			</Field.Group>
		</Field.Set>
	</Card>

	<Card class="flex flex-col gap-4 p-6">
		<Field.Set>
			<Field.Legend variant="label">{m.dictation_dictionary()}</Field.Legend>
			<Field.Description>
				{m.dictation_proper_nouns_and_domain_terms_tironian({ productName: PRODUCT_NAME })}
			</Field.Description>
			<Field.Group>
				<form
					class="flex gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						addTerm();
					}}
				>
					<Input placeholder={m.dictation_e_g_kubernetes()} bind:value={newTerm} />
					<Button type="submit" variant="outline">
						<PlusIcon class="size-4" /> {m.dictation_add()}
					</Button>
				</form>

				{#if dictionary.length > 0}
					<ul class="flex flex-wrap gap-2">
						{#each dictionary as term (term)}
							<li
								class="bg-muted/40 flex items-center gap-1 rounded-md border py-1 pr-1 pl-3 text-sm"
							>
								<span>{term}</span>
								<Button
									variant="ghost"
									size="icon"
									class="size-5"
									aria-label="Remove {term}"
									onclick={() => removeTerm(term)}
								>
									<XIcon class="size-3.5" />
								</Button>
							</li>
						{/each}
					</ul>
					{#if unreached.length > 0}
						<div
							class="border-amber-500/30 bg-amber-500/10 text-foreground flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm"
						>
							<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-amber-500" />
							<p>
								{m.dictation_everything_from()} <span class="font-medium">{unreached[0]}</span>
								onward ({unreached.length}
								{unreached.length === 1 ? 'term' : 'terms'}) does not reach the
								transcription model: it accepts only a short prompt, and your
								list is longer than that. Polish and Recipes still use every
								term.
								{#if systemPrompt}
									Your <Link href={dictationPath('/settings/processing')}
										>{m.dictation_transcription_system_prompt()}</Link
									> is sent first and takes part of the same room, so remove terms
									above the cut-off, or shorten that prompt, to make room.
								{:else}
									Remove terms above the cut-off to make room.
								{/if}
							</p>
						</div>
					{/if}
				{:else}
					<Field.Description>
						{m.dictation_no_terms_yet_add_the_names_and_jargon()}
					</Field.Description>
				{/if}
			</Field.Group>
		</Field.Set>
	</Card>
</main>
