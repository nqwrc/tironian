import { goto } from '$app/navigation';
import type { TironianApp } from '$lib/app/app';
import { DICTATION_RECORDINGS_PATHNAME } from '$lib/constants/urls';
import type { DeliveryOutcome } from '$lib/operations/delivery-reach';
import {
	clipboardSink,
	createCursorSink,
	ledgerSink,
	type Sink,
} from '$lib/operations/sink';
import type { Notice } from '$lib/report';
import { lastDelivery } from '$lib/state/last-delivery.svelte';
import { probeForegroundContext } from './foreground-probe';
import { decideSecureFieldGuard } from './secure-field-guard';

// The reach types live in their own `delivery-reach` module next to their ADR
// docstrings; re-exported here so callers keep one delivery import.
export type {
	DeliveryOutcome,
	DeliveryReach,
} from '$lib/operations/delivery-reach';
export type { SinkKind } from '$lib/operations/sink';

/**
 * The output scopes Tironian delivers into. Each has its own
 * clipboard/cursor/enter toggles under `settings.output.<scope>.*`. Keeping the list in
 * one place lets delivery and the auto-paste intent derive from the same source
 * instead of hardcoding the scope names.
 */
const OUTPUT_SCOPES = ['transcription', 'recipe'] as const;
type OutputScope = (typeof OUTPUT_SCOPES)[number];

/**
 * Where each scope's three delivery toggles live, as the workspace kv keys
 * that hold them. Written out rather than composed from the scope name: a
 * durable key is not something to compute from an identifier a rename could
 * change.
 */
const OUTPUT_KEYS = {
	transcription: {
		cursor: 'outputTranscriptionCursor',
		clipboard: 'outputTranscriptionClipboard',
		enter: 'outputTranscriptionEnter',
	},
	recipe: {
		cursor: 'outputRecipeCursor',
		clipboard: 'outputRecipeClipboard',
		enter: 'outputRecipeEnter',
	},
} as const;

/**
 * True when any output scope is set to write at the cursor. Cursor delivery is a
 * synthetic Cmd/Ctrl+V, so this is exactly when delivery needs the macOS
 * Accessibility grant, which is the one fact the tap supervisor holds the tap to
 * track. Call inside a reactive scope to stay live as the toggles change.
 */
export function outputWritesToCursor(app: TironianApp): boolean {
	return OUTPUT_SCOPES.some((scope) =>
		app.settings.get(OUTPUT_KEYS[scope].cursor),
	);
}

/**
 * Where a transcript originated: a live `recording` or an imported file
 * (`import`). Shapes the success copy and flows in from the pipeline's
 * `deliverySource`.
 */
export type TranscriptionSource = 'recording' | 'import';

const TRANSCRIPTION_SUCCESS_COPY = {
	recording: '📝 Recording transcribed',
	import: '📁 File transcribed',
} as const satisfies Record<TranscriptionSource, string>;

/** A delivery result: the structured outcome plus a human notice for toasts. */
export type DeliveryResult = {
	outcome: DeliveryOutcome;
	notice: Notice;
};

/**
 * Delivers transcript to the user according to their transcription output
 * preferences. Clipboard remains the cursor fallback and optional tee. Returns
 * the structured outcome plus a human notice; it does not toast. The dictation
 * path reads the outcome to drive the pill; file import and row actions show
 * the notice.
 */
export async function deliverTranscriptionResult(
	app: TironianApp,
	{
		text,
		source = 'recording',
	}: {
		text: string;
		source?: TranscriptionSource;
	},
): Promise<DeliveryResult> {
	return deliverToSink(app, {
		text,
		successCopy: TRANSCRIPTION_SUCCESS_COPY[source],
		sink: resolveSettingsSink(app, 'transcription'),
		// A transcription always belongs to a recording, so its history is reachable.
		linkedRecording: true,
	});
}

/**
 * Delivers a Recipe's output to the user according to their text output
 * preferences. Returns the structured outcome plus a human notice. `recordingId`
 * is the run's link to a recording, or null for ad-hoc runs (clipboard,
 * selection): only a recording-anchored run offers a "go to recordings" action,
 * since an ad-hoc run has no history to open.
 */
export async function deliverRecipeResult(
	app: TironianApp,
	{
		text,
		recordingId,
	}: {
		text: string;
		recordingId: string | null;
	},
): Promise<DeliveryResult> {
	return deliverToSink(app, {
		text,
		successCopy: '🔄 Recipe complete',
		sink: resolveSettingsSink(app, 'recipe'),
		linkedRecording: recordingId !== null,
	});
}

function resolveSettingsSink(
	app: TironianApp,
	settingsScope: OutputScope,
): Sink {
	const keys = OUTPUT_KEYS[settingsScope];
	const cursorRequested = app.settings.get(keys.cursor);
	const clipboardRequested = app.settings.get(keys.clipboard);

	return cursorRequested
		? createCursorSink({
				keepOnClipboard: clipboardRequested,
				pressEnter: app.settings.get(keys.enter),
			})
		: clipboardRequested
			? clipboardSink
			: ledgerSink;
}

async function deliverToSink(
	app: TironianApp,
	{
		text,
		successCopy,
		sink,
		linkedRecording,
	}: {
		text: string;
		successCopy: string;
		sink: Sink;
		linkedRecording: boolean;
	},
): Promise<DeliveryResult> {
	const recordingsAction = linkedRecording
		? {
				label: 'Go to recordings',
				onClick: () => goto(DICTATION_RECORDINGS_PATHNAME),
			}
		: undefined;

	// Any delivery invalidates the previous one: whatever was held is no longer
	// the last thing at the cursor. The dictation pipeline records the new one
	// straight after this returns; every other path (file import, a recordings
	// row, a recipe) simply leaves nothing held, so "scratch that" refuses
	// rather than backspacing into text it did not deliver.
	lastDelivery.clear();

	// The secure-field guard, re-sampled at paste time because the paste lands
	// wherever focus is now, not where it was at capture. Only a cursor or
	// clipboard sink can put text somewhere dangerous, and blocking the
	// clipboard too is deliberate: "copied" next to a password field invites
	// the exact wrong paste. On a withhold the ledger sink substitutes, so the
	// text survives in history and nothing else changes hands.
	// One probe, two readers. The guard wants the focused field; the undo record
	// wants the app id, so "scratch that" can tell later whether the window it
	// would backspace into is still the one that got the text.
	//
	// Skipped when neither reader exists, because it is a cross-process round
	// trip on the path a person is waiting on. A ledger delivery writes to
	// history, where no keystroke can go wrong; a clipboard delivery with the
	// guard off has no reader either, since only a cursor write is undoable
	// (`last-delivery.svelte.ts`).
	const guardEnabled = app.settings.get('secureFieldGuardEnabled');
	const foreground =
		sink.kind !== 'ledger' && (guardEnabled || sink.kind === 'cursor')
			? await probeForegroundContext()
			: { focusedField: 'unknown' as const, appId: null };

	const effectiveSink = ((): { sink: Sink; withheld: boolean } => {
		if (sink.kind === 'ledger') return { sink, withheld: false };
		const decision = decideSecureFieldGuard({
			focusedField: foreground.focusedField,
			enabled: guardEnabled,
		});
		return decision === 'withhold'
			? { sink: ledgerSink, withheld: true }
			: { sink, withheld: false };
	})();

	const { reach, pressedEnter } = await effectiveSink.sink.deliver(text);

	const title = effectiveSink.withheld
		? `${successCopy}, kept in history (a password field has focus)`
		: effectiveSink.sink.kind === 'cursor'
			? reach === 'output'
				? `${successCopy} and written to cursor!`
				: `${successCopy}, copied to clipboard (couldn't write to cursor)`
			: `${successCopy}!`;

	return {
		outcome: {
			reach,
			sinkKind: effectiveSink.sink.kind,
			pressedEnter,
			withheld: effectiveSink.withheld,
			// Null on a withhold: nothing was written, so naming an app the text
			// went to would be a lie a later undo could act on.
			deliveredToAppId: effectiveSink.withheld ? null : foreground.appId,
		},
		notice: { title, description: text, action: recordingsAction },
	};
}
