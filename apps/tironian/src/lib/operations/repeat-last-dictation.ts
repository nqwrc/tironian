/**
 * Paste or copy the last dictation again, from a global chord.
 *
 * Not `deliverToSink`: that path presses the configured Enter, clears the
 * undo record before it knows whether anything will be written, and toasts a
 * success copy meant for a fresh transcription. A repeat wants none of that, so
 * it re-runs the two pieces it does want, the secure-field guard and the
 * cursor sink, here. The undo record is replaced only when the paste reached
 * the cursor: a clipboard fallback leaves the previous record, whose text is
 * still where it was put.
 *
 * One repeat runs at a time (see `exclusive`), and everything a write depends
 * on is read just before it, after the wait for the chord's modifiers.
 *
 * Paste writes at the cursor whatever the output settings say, and presses no
 * Enter. On macOS with cursor output off the paste ends on the clipboard
 * instead: the host only pastes while its event tap is running, and the tap is
 * off when cursor output is. The person gets the "left on the clipboard" notice
 * then, not an insertion.
 *
 * Feedback goes to the OS notification centre too when Tironian is not in
 * front, because a global chord usually fires with the window hidden and a
 * toast there would be a silent no-op.
 */
import { osNotify } from '#platform/os-notify';
import type { TironianApp } from '$lib/app/app';
import { probeForegroundContext } from '$lib/operations/foreground-probe';
import { decideSecureFieldGuard } from '$lib/operations/secure-field-guard';
import { createCursorSink } from '$lib/operations/sink';
import { report } from '$lib/report';
import { services } from '$lib/services';
import { dictationLifecycle } from '$lib/state/dictation-lifecycle.svelte';
import { lastDelivery } from '$lib/state/last-delivery.svelte';
import { lastDictation } from '$lib/state/last-dictation.svelte';
import { MODIFIER_RELEASE_WAIT_MS } from '../constants/modifier-release';
import { m } from '../paraglide/messages';

function announce(title: string, description?: string): void {
	report.info({ title, description });
	if (typeof document !== 'undefined' && !document.hasFocus()) {
		void osNotify(title, description);
	}
}

/**
 * Whether a dictation is between the end of its recording and its delivery.
 * The kind stays `transcribing` or `polishing` until `markDelivered`, so these
 * two are the whole in-flight window. `delivered` is not: a reduced-reach
 * delivery holds that outcome until the next dictation, and it is finished.
 */
function dictationInFlight(): boolean {
	const { kind } = dictationLifecycle.current.outcome;
	return kind === 'transcribing' || kind === 'polishing';
}

/**
 * The held text, or null. The held dictation is dropped when its recording row
 * is gone or when either transcript field no longer matches the snapshot taken
 * as it shipped: deleting or editing the recording in Recordings must also take
 * the old words out of reach of the chord.
 */
export function resolveLastDictationText(app: TironianApp): string | null {
	const held = lastDictation.peek();
	if (held === null) return null;
	const row = app.recordings.get(held.recordingId);
	if (
		row === undefined ||
		row.transcript !== held.transcript ||
		row.polishedTranscript !== held.polishedTranscript
	) {
		lastDictation.clear();
		return null;
	}
	return held.text;
}

/**
 * The text to repeat, or null after telling the person why there is none.
 * A dictation still on its way refuses first: the holder is about to be
 * replaced, and repeating the previous one now would paste into the middle of
 * the delivery.
 */
function textToRepeat(app: TironianApp): string | null {
	if (dictationInFlight()) {
		announce(m.repeat_in_flight());
		return null;
	}
	const text = resolveLastDictationText(app);
	if (text === null) {
		announce(
			m.repeat_nothing_to_paste(),
			m.repeat_nothing_to_paste_description(),
		);
	}
	return text;
}

/**
 * Whether a paste or copy is already running. Both end in a clipboard write,
 * and the host's clipboard borrow (save the person's clipboard, write, paste,
 * restore) assumes one write at a time: a second chord landing inside the
 * first's borrow would snapshot the dictation as if it were the person's own
 * clipboard and restore that. A tap of the chord twice fires two releases
 * within milliseconds, so this is reachable, not theoretical.
 */
let repeatRunning = false;

async function exclusive(run: () => Promise<void>): Promise<void> {
	if (repeatRunning) {
		announce(m.repeat_busy());
		return;
	}
	repeatRunning = true;
	await run().finally(() => {
		repeatRunning = false;
	});
}

export function pasteLastDictation(app: TironianApp): Promise<void> {
	return exclusive(async () => {
		if (textToRepeat(app) === null) return;
		// The paste synthesizes Ctrl/Cmd+V, and the chord that fired this may still
		// have Ctrl+Shift or Ctrl+Alt down. If its modifiers do not lift, pasting
		// would send a different shortcut, so the text goes to the clipboard instead
		// and the person pastes it themselves.
		const modifiersUp = await services.text.waitForModifiersReleased(
			MODIFIER_RELEASE_WAIT_MS,
		);
		// Everything the write depends on is read after the wait, which can take
		// up to MODIFIER_RELEASE_WAIT_MS: focus can move, and a dictation can start
		// or finish. The guard reads the field and the undo record reads the app,
		// so the probe always runs.
		const foreground = await probeForegroundContext();
		const decision = decideSecureFieldGuard({
			focusedField: foreground.focusedField,
			enabled: app.settings.get('secureFieldGuardEnabled'),
		});
		if (decision === 'withhold') {
			announce(m.repeat_withheld());
			return;
		}
		const text = textToRepeat(app);
		if (text === null) return;
		if (!modifiersUp) {
			const { error } = await services.text.copyToClipboard(text);
			if (error !== null) {
				report.error({ title: m.repeat_copy_failed(), cause: error });
				return;
			}
			announce(m.repeat_keys_held());
			return;
		}
		const sink = createCursorSink({
			keepOnClipboard: app.settings.get('outputTranscriptionClipboard'),
			pressEnter: false,
		});
		const { reach } = await sink.deliver(text);
		if (reach !== 'output') {
			// The previous record stays: its text is still where it was put, and a
			// clipboard fallback is not something "scratch that" can undo.
			announce(m.repeat_left_on_clipboard());
			return;
		}
		// "Scratch that" now undoes this repeat, in the app it went to.
		lastDelivery.record({
			text,
			sinkKind: 'cursor',
			reach,
			pressedEnter: false,
			appId: foreground.appId,
		});
	});
}

export function copyLastDictation(app: TironianApp): Promise<void> {
	return exclusive(async () => {
		if (textToRepeat(app) === null) return;
		if (app.settings.get('secureFieldGuardEnabled')) {
			const { focusedField } = await probeForegroundContext();
			if (
				decideSecureFieldGuard({ focusedField, enabled: true }) === 'withhold'
			) {
				announce(m.repeat_withheld());
				return;
			}
		}
		// The probe is async: a dictation may have started behind it.
		const text = textToRepeat(app);
		if (text === null) return;
		const { error } = await services.text.copyToClipboard(text);
		if (error !== null) {
			report.error({ title: m.repeat_copy_failed(), cause: error });
			return;
		}
		announce(m.repeat_copied());
	});
}
