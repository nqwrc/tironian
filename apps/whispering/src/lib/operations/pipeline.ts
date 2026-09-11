import type { BlobId } from '@tironian/blobs';
import { InstantString } from '@tironian/field';
import {
	deliverTranscriptionResult,
	type TranscriptionSource,
} from '$lib/operations/delivery';
import { expandSnippets } from '$lib/operations/expand-snippets';
import { matchCommand } from '$lib/operations/match-command';
import { polishWillRun, runPolish } from '$lib/operations/run-polish';
import { runRecipe } from '$lib/operations/run-recipe';
import {
	commandApplies,
	runVoiceCommand,
} from '$lib/operations/run-voice-command';
import { playSoundIfEnabled } from '$lib/operations/sound';
import { transcribeAndPersist } from '$lib/operations/transcribe';
import { saveRecordingHistory } from '$lib/operations/transcription-history';
import { report } from '$lib/report';
import { dictationLifecycle } from '$lib/state/dictation-lifecycle.svelte';
import { lastDelivery } from '$lib/state/last-delivery.svelte';
import { polishHud } from '$lib/state/polish-hud.svelte';
import type { WhisperingApp } from '$lib/whispering/app';
import { m } from '../paraglide/messages';
import type { ForegroundSnapshot } from './foreground-context';
import { matchAppRule } from './match-app-rule';
import { deadlineForCapture } from './transcription-deadline';

/**
 * Argument shape for the pipeline. The recorder produces a
 * `RecorderStopResult`; the VAD path and file import path build the
 * equivalent finalized shape. `deliverySource` is forwarded
 * straight to delivery, so it shares delivery's `TranscriptionSource` type.
 */
type PipelineInput = {
	audioBlobId: BlobId;
	durationMs: number | null;
	deliverySource?: TranscriptionSource;
	/**
	 * The foreground app at capture start, for per-app rule routing. In-memory
	 * only: it is never written to the recording row, so app usage stays out of
	 * the synced replica. Absent for file imports and callers with no capture
	 * moment; routing then simply does not apply.
	 */
	foregroundApp?: ForegroundSnapshot | null;
};

/**
 * The tail of the run queue. Every acquisition path funnels through it, so
 * runs deliver in the order their audio was captured.
 *
 * Without this the three call sites are unordered: `onSpeechEnd` is typed
 * `(blob: Blob) => void` and invoked without an await (`vad-recorder.ts:159`),
 * so an async handler returns a floating promise, and a manual stop or a file
 * import can start while a VAD run is still in flight. Two runs then race to
 * the same cursor, and the loser is whichever transcribes slower. With
 * `polishEnabled` on by default a long utterance takes an LLM round trip that
 * a short one does not, so the short one wins: this is the common case, not an
 * edge.
 *
 * Interleaved paste would be bad enough. `lastDelivery.record()` below is the
 * part that destroys text: it holds the grapheme count "scratch that"
 * backspaces, so an out-of-order run leaves the undo pointed at a delivery
 * that is no longer what is at the cursor, and the command deletes that many
 * characters of whatever is. Ordering the runs orders that state with them,
 * which is why the queue belongs here rather than around one call site.
 */
let runQueue: Promise<void> = Promise.resolve();

/**
 * Processes finalized local audio through row creation, transcription, and
 * polishing.
 *
 * Audio bytes never live in pipeline state. Every acquisition path has
 * committed the local blob before calling this operation.
 *
 * Runs are serialized (see `runQueue`). A caller still awaits its own run and
 * still sees its own failure; what it no longer does is overlap another one.
 */
export function processRecordingPipeline(
	app: WhisperingApp,
	input: PipelineInput,
): Promise<void> {
	const run = runQueue.then(() => runRecordingPipeline(app, input));
	// The queue must outlive a failed run. Keeping the rejection in the tail
	// would reject every later utterance without ever running it, turning one
	// bad transcription into a dead dictation session.
	runQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

/**
 * One run, start to finish. `deliverySource` only shapes the success copy
 * (recording vs file import).
 */
async function runRecordingPipeline(
	app: WhisperingApp,
	{
		audioBlobId,
		durationMs,
		deliverySource = 'recording',
		foregroundApp,
	}: PipelineInput,
) {
	const now = InstantString.now();

	// A live dictation (not a file import) drives the dictation pill. The
	// recorder is already idle by the time we get here, so the lifecycle hands
	// the pill from `recording` to `transcribing`. File imports have their own
	// surface, so they leave the dictation lifecycle untouched.
	const isDictation = deliverySource === 'recording';
	if (isDictation) dictationLifecycle.markTranscribing();

	// Row creation owns row/blob consistency: on failure it removes the
	// already-committed audio and rethrows, so a lost row never strands bytes.
	const recording = app.recordings.create({
		audioBlobId,
		title: '',
		recordedAt: now,
		recordedAtZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		transcript: '',
		polishedTranscript: null,
		duration: durationMs,
		// The recording domain initializes the transcription columns explicitly, so
		// a fresh recording is `pending` with no completion and no error.
	});

	// File import has no pill, so it keeps a progress toast; the dictation path is
	// driven by the lifecycle markers above (the pill), with no toast.
	const transcribeLoading = isDictation
		? null
		: report.loading({
				title: m.pipeline_transcribing(),
				description: m.pipeline_your_recording_is_being_transcribed(),
			});

	// A live dictation takes the tight deadline, a file import or a long manual
	// capture the generous one. Both facts the choice needs are already here and
	// both are exact rather than estimated, so `deadlineForCapture` is handed
	// them rather than guessing from the audio.
	const { data: transcription, error: transcribeError } =
		await transcribeAndPersist(app, recording.id, audioBlobId, {
			deadline: deadlineForCapture({
				isDictation,
				audioDurationMs: durationMs,
			}),
		});

	if (transcribeError) {
		if (isDictation) {
			dictationLifecycle.markFailed({
				tier: 'transcription',
				error: transcribeError,
			});
		} else {
			transcribeLoading?.reject({ cause: transcribeError });
		}
		return;
	}
	const { text: transcribedText } = transcription;
	let history = transcription.history;

	// Nothing was said, so nothing is delivered.
	//
	// An empty transcript is a real outcome, not a degenerate success: the
	// recognizer was skipped because the recording held no speech
	// (`operations/transcribe.ts`), or a provider genuinely heard nothing. The
	// rest of this function assumes there are words to hand over, and running it
	// on none does active harm. Delivery writes the transcript to the sink, and
	// writing an empty string to the clipboard destroys whatever the user had
	// copied: tapping push-to-talk by accident would silently cost them their
	// clipboard. The completion chime is a receipt for text that landed, so
	// sounding it for no text is a lie the ear believes. Polish has nothing to
	// polish.
	//
	// The pill retires instead of reporting, because there is nothing to report:
	// the outcome track goes back to `none` and the overlay hides, which is what
	// a person who said nothing expects to see. The recording row is still
	// written, so the attempt stays visible where the durable record lives.
	if (transcribedText.trim() === '') {
		if (isDictation) {
			dictationLifecycle.reset();
		} else {
			transcribeLoading?.resolve({
				title: m.pipeline_no_speech_detected(),
				description: m.pipeline_the_recording_had_nothing_to_transcribe(),
			});
		}
		return;
	}

	// Command Mode intercepts here, before Polish: Polish would reword "scratch
	// that" into prose, so a matcher downstream of it would only ever see the
	// phrase destroyed. A match ends the pipeline, so nothing below runs: no
	// snippet expansion, no polished write, no completion sound, no delivery.
	//
	// Live capture only, and applicable only. `isDictation` is true in manual
	// mode as well as VAD, so a phrase whose target is not live falls through and
	// delivers as ordinary text rather than silently eating the utterance.
	if (isDictation && app.settings.get('commandModeEnabled')) {
		const command = matchCommand(transcribedText);
		if (command !== null && commandApplies(command)) {
			await runVoiceCommand(app, command);
			// A command delivers no text, so there is no outcome to show. Clear the
			// `transcribing` marker set on the way in, or the pill spins forever on
			// work that already finished.
			dictationLifecycle.reset();
			// The recordings row is the audit trail for the case that needs one: a
			// misfire. A command utterance still returns before the row's usual
			// history-error report at the end of this function, so it needs its own.
			if (history.error !== null) {
				report.info({
					title: m.pipeline_transcription_delivered_but_history_may_be(),
					description: history.error.message,
				});
			}
			return;
		}
	}

	// Which per-app rule applies, decided from the app in front at capture
	// start. Resolved after the command-mode intercept (commands stay senior to
	// routing) and before Polish, whose directive the rule may replace. No
	// snapshot or no match means the global behavior, unchanged.
	const appRule =
		isDictation && foregroundApp
			? matchAppRule({
					appId: foregroundApp.appId,
					rules: app.appRules.all,
					platform: foregroundApp.platform,
				})
			: null;

	// Run Polish over the raw transcript, then deliver the polished text. When
	// history succeeds, the raw stays on `recordings.transcript` so "show
	// original" is recoverable. We hold delivery until Polish finishes and
	// deliver once, with the final text: delivering the raw and then the polished
	// version would land two copies (a clipboard the user might paste mid-polish,
	// or two cursor pastes), the exact race the deliver-after-polish rule exists to
	// dodge. Polish is the only thing on the automatic path; there is no
	// auto-running Recipe. See ADR-0099.
	//
	// The "Polishing…" HUD and its ship-raw control live on the dictation pill, so
	// the lifecycle's polishing phase and the abort signal are dictation-only: file
	// import has no pill to cancel from and keeps its own progress toast. The pill
	// shows the HUD only when an AI pass actually runs (not in speed mode); begin/end
	// bracket the call so the controller is dropped on success, failure, or abort.
	const willPolish = polishWillRun(app, transcribedText);
	const showPolishHud = willPolish && isDictation;
	let signal: AbortSignal | undefined;
	if (showPolishHud) {
		dictationLifecycle.markPolishing();
		signal = polishHud.begin();
	}
	const { data: polishedText, error: polishError } = await runPolish(app, {
		input: transcribedText,
		signal,
		// The rule's directive and its standing travel together: a rule minted by
		// a settings bundle is untrusted until the person vouches for it, and a
		// demoted directive describes the style rather than commanding the pass.
		override:
			appRule?.polishInstructions != null
				? {
						instructions: appRule.polishInstructions,
						trusted: appRule.trusted,
					}
				: undefined,
	});
	if (showPolishHud) polishHud.end();
	// Polish is best-effort: a failed AI pass carries the raw transcript in
	// `fallback`, so a transcript is never lost to a polish error. Surface the
	// failure without blocking delivery.
	let polishOutput = polishError ? polishError.fallback : polishedText;
	if (polishError) {
		report.info({
			title: m.pipeline_polishing_skipped(),
			description: polishError.message,
		});
	}

	// A per-app rule may auto-run one recipe over the polished text, before
	// snippets so snippets stay last-before-delivery (ADR-0099's ordering with
	// one added step). Best-effort like Polish: a dangling recipe id or a
	// failed AI call degrades to the polished text with a notice, never a
	// failed dictation. This is a second AI call, so it only ever happens
	// because the user named a recipe on the rule.
	//
	// The pill keeps its "Flowing…" HUD and ship-raw control armed for this
	// call too: a person who hits the X during a rule's recipe means "ship
	// without further AI", so an abort delivers the un-reshaped text as a
	// clean outcome, exactly like aborting Polish ships the raw transcript.
	let recipeReshaped = false;
	if (appRule?.recipeId != null) {
		const recipe = app.recipes.pickable.find(
			(candidate) => candidate.id === appRule.recipeId,
		);
		if (recipe === undefined) {
			report.info({
				title: m.pipeline_app_rule_recipe_missing(),
				description: `The "${appRule.name}" rule names a recipe that no longer exists, so the text shipped un-reshaped.`,
			});
		} else {
			let recipeSignal: AbortSignal | undefined;
			if (isDictation) {
				dictationLifecycle.markPolishing();
				recipeSignal = polishHud.begin();
			}
			const reshaped = await runRecipe(app, {
				input: polishOutput,
				recipe,
				signal: recipeSignal,
			});
			if (isDictation) polishHud.end();
			if (reshaped.error !== null) {
				if (!recipeSignal?.aborted) {
					report.info({
						title: m.pipeline_recipe_skipped(),
						description: reshaped.error.message,
					});
				}
			} else {
				polishOutput = reshaped.data;
				recipeReshaped = true;
			}
		}
	}

	// Snippets expand after Polish and before delivery, on whichever text is
	// about to ship. A trigger Polish reworded simply will not match, which
	// shows up as the literal trigger in the output: visible, and recoverable.
	const deliveredText = expandSnippets(polishOutput, app.snippets.all);

	// Attempt to persist the delivered transcript alongside the raw transcript so
	// history can show what was actually delivered, with the original one click
	// away. Only write when a Polish pass actually produced a result: row creation
	// already left `polishedTranscript` null, so speed mode (no AI call) and a
	// polish failure (the fallback carries the raw words) need no second write.
	//
	// Snippet expansion rides along in `deliveredText`, so a polished row records
	// what shipped. The two no-write paths keep only the unexpanded transcript,
	// which is the existing speed-mode tradeoff and not something snippets change.
	// A rule's recipe reshaping also earns the write: even in speed mode, a
	// reshaped delivery differs from the raw transcript and history should show
	// what actually shipped.
	if ((willPolish && !polishError) || recipeReshaped) {
		const polishedHistory = await saveRecordingHistory(app, recording.id, {
			polishedTranscript: deliveredText,
		});
		if (polishedHistory.error !== null) history = polishedHistory;
	}

	// The transcript is "ready" once it is polished and about to be delivered, so
	// the completion sound and the resolved loading notice both fire here.
	void playSoundIfEnabled(app, 'transcriptionComplete');
	const { outcome: transcriptDelivery, notice: transcribeNotice } =
		await deliverTranscriptionResult(app, {
			text: deliveredText,
			source: deliverySource,
		});

	// Hold what was delivered so "scratch that" has something to take back.
	// Dictation only: undoing a file import would target a paste the person
	// never dictated. The outcome carries the sink kind and whether an Enter
	// followed, which is what decides whether a backspace can reach it at all.
	// A withheld delivery holds nothing: no paste happened, so there is nothing
	// at the cursor for an undo to take back.
	if (isDictation && !transcriptDelivery.withheld) {
		lastDelivery.record({
			text: deliveredText,
			sinkKind: transcriptDelivery.sinkKind,
			reach: transcriptDelivery.reach,
			pressedEnter: transcriptDelivery.pressedEnter,
			appId: transcriptDelivery.deliveredToAppId,
		});
	}
	if (isDictation) {
		if (transcriptDelivery.withheld) {
			// The secure-field guard refused the configured output; the transcript
			// lives only in history. This persists on the pill like a reduced reach
			// does, because nothing landed to corroborate the dictation and the tag
			// is the only explanation the user gets.
			dictationLifecycle.markWithheld();
		} else {
			// The delivered transcript is the dictation receipt. Every reach is a success,
			// even when history could not be confirmed, so this is always `delivered`; the reach decides
			// whether the pill flashes (clean `output`) or persists (a reduced
			// `clipboard`). The word count rides the same event so the pill can show
			// "N words" without a second round trip for the delivered text.
			const wordCount = deliveredText
				.trim()
				.split(/\s+/)
				.filter(Boolean).length;
			dictationLifecycle.markDelivered(transcriptDelivery.reach, wordCount);
		}
	} else {
		transcribeLoading?.resolve(transcribeNotice);
	}
	if (history.error !== null) {
		report.info({
			title: m.pipeline_transcription_delivered_but_history_may_be(),
			description: history.error.message,
		});
	}
}
