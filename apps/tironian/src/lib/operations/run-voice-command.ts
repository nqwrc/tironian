/**
 * The effect half of Command Mode. `match-command` stays pure and app-free;
 * everything that touches live state lives here.
 */
// Relative rather than `$lib` for these two alone. Every other `$lib` import in
// this file is faked by the suite, which is the repo's convention because `$lib`
// has no runtime resolution under `bun test`. Faking the product name or the
// message catalogue would make the delivered-copy assertions circular: the test
// would compare a string against the same string it just supplied.

import { createLogger } from 'wellcrafted/logger';
import type { TironianApp } from '$lib/app/app';
import { probeForegroundContext } from '$lib/operations/foreground-probe';
import type { VoiceCommandId } from '$lib/operations/match-command';
import {
	isVadRecordingActive,
	stopVadRecording,
} from '$lib/operations/recording';
import { decideUndoTarget } from '$lib/operations/undo-target';
import { report } from '$lib/report';
import { services } from '$lib/services';
import { lastDelivery } from '$lib/state/last-delivery.svelte';
import { PRODUCT_NAME } from '../constants/brand';
import { m } from '../paraglide/messages';

const log = createLogger('tironian/voice-command');

/**
 * The most backspaces one undo may send, mirroring the host's own cap. Checked
 * here as well so an over-long dictation gets a calm notice rather than the
 * host's opaque refusal surfacing as an error.
 */
const MAX_BACKSPACES = 2000;

/**
 * Whether this command has anything to act on right now.
 *
 * A matched phrase is not enough to swallow an utterance: a command applies
 * only when it can actually act. `isDictation` is true in manual mode as well
 * as VAD, so "stop listening" during a manual dictation would otherwise
 * match, do nothing, and eat the words: no text and no action. An
 * inapplicable "stop listening" falls through and delivers as ordinary text
 * instead, and an inapplicable "scratch that" does the same.
 *
 * Cursor output ships on by default, so the ordinary case is now that an undo
 * has something to take back. The fallthrough still carries real weight: with
 * the Enter toggle on, after a cursor write that fell back to the clipboard
 * because the OS refused it, after a withheld delivery, and on every path that
 * delivers without recording one (a file import, a recordings row, a recipe),
 * nothing is undoable. Unconditionally swallowing the utterance in those
 * states would eat the words and do nothing.
 */
export function commandApplies(id: VoiceCommandId): boolean {
	switch (id) {
		case 'scratchThat':
			return lastDelivery.canUndo();
		case 'stopListening':
			return isVadRecordingActive();
	}
}

export async function runVoiceCommand(
	app: TironianApp,
	id: VoiceCommandId,
): Promise<void> {
	switch (id) {
		case 'scratchThat':
			return scratchThat();
		case 'stopListening':
			log.info('Voice command stopped the listening session');
			return stopVadRecording(app);
	}
}

async function scratchThat(): Promise<void> {
	// Read without consuming: a refusal below has to leave the record alive, or
	// the copy telling the person to switch back and say it again would be a lie.
	const undo = lastDelivery.peek();
	if (undo === null) {
		// Defensive, not the common case: `commandApplies` already checked
		// `canUndo()` against this same held state with no `await` in between, so
		// reaching here would mean the two checks disagreed. Kept as a notice
		// rather than a silent no-op in case that ever changes.
		report.info({
			title: m.run_voice_command_nothing_to_undo(),
			description: m.undo_nothing_at_cursor({ productName: PRODUCT_NAME }),
		});
		return;
	}

	if (undo.graphemes > MAX_BACKSPACES) {
		// Consumed: no retry helps, and the copy promises none.
		lastDelivery.take();
		report.info({
			title: m.run_voice_command_that_dictation_is_too_long_to_undo(),
			description: m.run_voice_command_undo_is_capped_at_2000_characters(),
		});
		return;
	}

	// The backspaces go wherever focus is right now, not where the text went, so
	// the window has to be the same one. Fail-closed, unlike the secure-field
	// guard, because a wrong refusal costs a sentence of copy and a wrong allow
	// costs text the person already had (`undo-target.ts`).
	//
	// Both refusals keep the record. Holding it is safe precisely because this
	// check runs every time: a third window will not match either, so the undo
	// cannot wander. Keeping it is also what makes the copy true, and it means a
	// probe that merely timed out has not destroyed the undo. The standing
	// tradeoff is unchanged: a keystroke undo deletes the last N characters at
	// the cursor, so typing more in the original app before switching back is
	// still the person's to avoid.
	const target = decideUndoTarget({
		deliveredTo: undo.appId,
		focusedNow: (await probeForegroundContext()).appId,
	});
	if (target === 'moved') {
		report.info({
			title: m.run_voice_command_that_dictation_is_in_another_window(),
			description: m.run_voice_command_undo_only_removes_text_from_the_app(),
		});
		return;
	}
	if (target === 'unknown') {
		report.info({
			title: m.run_voice_command_couldn_t_tell_which_window_to_undo(),
			description: m.undo_unknown_app({ productName: PRODUCT_NAME }),
		});
		return;
	}

	// Consumed here, on the one path that fires. A second "scratch that" must
	// find nothing held rather than deleting another paste's worth of characters.
	lastDelivery.take();
	const { error } = await services.text.simulateBackspaces(undo.graphemes);
	if (error !== null) {
		// The held record is already gone, which is what we want: after a partial
		// delete the count no longer describes what is on screen.
		report.error({
			title: m.run_voice_command_couldn_t_undo_the_last_dictation(),
			cause: error,
		});
		return;
	}
	log.info('Voice command undid the last dictation', {
		graphemes: undo.graphemes,
	});
}
