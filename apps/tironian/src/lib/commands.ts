import { platformCommands } from '#platform/commands';
import { goto } from '$app/navigation';
import type { TironianApp } from '$lib/app/app';
import { dictationPath } from '$lib/constants/urls';
import { handsFreePushToTalk } from '$lib/operations/hands-free-instance';
import { runRecipeOnClipboard } from '$lib/operations/recipe-clipboard';
import {
	cancelRecording,
	toggleManualRecording,
	toggleVadRecording,
} from '$lib/operations/recording';
import type { Reach } from '$lib/utils/key-binding';
import { m } from './paraglide/messages';

/**
 * Registry of available commands in the app.
 * Defines what commands exist and how they're triggered (keyboard shortcuts,
 * voice, command palette, etc.).
 *
 * The actual command implementations live in $lib/operations/* as plain async
 * functions that can be invoked from anywhere in the UI, not just through this
 * command registry.
 *
 * Platform split: `sharedCommands` exist in every build. Desktop-only commands
 * (the recipe picker, which captures a selection from another app and raises the
 * in-app palette over it) come from the `#platform/commands` seam, so a browser
 * build never imports their Tauri-only code and never offers them as shortcuts.
 */

/**
 * The keyboard event state passed to callbacks: a trigger backend reports
 * either the press or the release edge. Both the desktop plugin backend (whose
 * `ShortcutEvent.state` is this pair) and the browser keydown backend speak it,
 * so the command layer is the single point where they converge.
 */
export type ShortcutEventState = 'Pressed' | 'Released';

export type SatisfiedCommand = {
	id: string;
	title: string;
	/** Settings section and command-palette grouping. */
	category: string;
	/** Extra command-palette search text beyond the title. */
	keywords?: string;
	/**
	 * The command's intrinsic reach ceiling: the farthest it could ever fire,
	 * fixed by its nature rather than chosen by the user. `global` (recording,
	 * cancel) is meaningful from any app; `focused` (navigation) only with
	 * Tironian in front. Required, because reach is the headline fact of a
	 * command, so it is always stated rather than defaulted; `focused` is the
	 * conservative choice for a new command. It is the first term of
	 * `realizedReach` (see {@link Reach} and ADR-0052).
	 */
	reach: Reach;
	/**
	 * When to trigger `run`.
	 * - ['Pressed']: Only on key press
	 * - ['Released']: Only on key release
	 * - ['Pressed', 'Released']: On both press and release
	 */
	on: ShortcutEventState[];
	/** Every command runs against the ready app it was dispatched with. */
	run: (app: TironianApp, state?: ShortcutEventState) => void;
};

/** Commands available in every build (browser and desktop). */
const sharedCommands = [
	{
		id: 'pushToTalk',
		title: m.commands_push_to_talk(),
		category: 'Recording',
		reach: 'global',
		// Hold to record, release to stop. The push-to-talk controller owns the
		// recording its press starts: a release or a 5-minute cap stops only that
		// session, and a release that lands before startup finishes is still honored.
		// Not "the edges are the whole state machine": a lost release edge would
		// otherwise leave recording stuck on. Both the desktop global-shortcut plugin
		// and the browser keydown backend emit the Pressed/Released pair. Ships
		// bound globally to a per-platform hold chord
		// (`DEFAULT_GLOBAL_BINDINGS.pushToTalk` is the source of truth).
		// Routed through `handsFreePushToTalk` rather than calling `pushToTalk`
		// directly: a double-tap (two Pressed within 400ms) locks the mic open
		// hands-free, so the second tap's Released is swallowed instead of
		// stopping the recording (`operations/hands-free.ts`).
		on: ['Pressed', 'Released'],
		run: (app, state?: ShortcutEventState) => {
			if (state === 'Pressed') return handsFreePushToTalk.onPressed(app);
			if (state === 'Released') return handsFreePushToTalk.onReleased(app);
		},
	},
	{
		id: 'toggleManualRecording',
		title: m.commands_toggle_recording(),
		category: 'Recording',
		reach: 'global',
		// Press once to start and again to stop. This is also what the record button
		// fires (a click arrives with no edge). It ships with the default global
		// recording chord; push-to-talk ships with its own default hold chord
		// for users who prefer a hold.
		on: ['Pressed'],
		run: (app) => toggleManualRecording(app),
	},
	{
		id: 'cancelRecording',
		title: m.commands_cancel_recording(),
		category: 'Recording',
		reach: 'global',
		on: ['Pressed'],
		run: (app) => cancelRecording(app),
	},
	{
		id: 'toggleVadRecording',
		title: m.commands_toggle_voice_activated_recording(),
		category: 'Recording',
		reach: 'global',
		on: ['Pressed'],
		run: (app) => toggleVadRecording(app),
	},
	{
		id: 'runRecipeOnClipboard',
		title: m.commands_run_recipe_on_clipboard(),
		category: 'Recipe',
		reach: 'global',
		on: ['Pressed'],
		run: () => runRecipeOnClipboard(),
	},
	{
		id: 'openSettings',
		title: m.commands_open_settings(),
		category: 'Navigation',
		// The first focused-reach command: navigation is meaningless from another
		// app, so its reach ceiling is `focused`. A capable chord like Cmd+, cannot
		// escape that ceiling (realizedReach clamps it to focused), so it never
		// registers globally; it fires only with Tironian in front. See ADR-0052.
		reach: 'focused',
		on: ['Pressed'],
		run: () => goto(dictationPath('/settings')),
	},
] as const satisfies SatisfiedCommand[];

export const commands = [
	...sharedCommands,
	...platformCommands,
] as const satisfies SatisfiedCommand[];

export type Command = (typeof commands)[number];

export type CommandRunners = Record<Command['id'], Command['run']>;

/** Command runners with the app already bound (the DevTools surface). */
export type BoundCommandRunners = Record<
	Command['id'],
	(state?: ShortcutEventState) => void
>;

export const commandRunners = commands.reduce<CommandRunners>(
	(acc, command) => {
		acc[command.id] = command.run;
		return acc;
	},
	{} as CommandRunners,
);

type TriggerTarget = {
	on: readonly ShortcutEventState[];
	run: (app: TironianApp, state?: ShortcutEventState) => void;
};
const triggerTargetById = new Map<string, TriggerTarget>(
	commands.map((c) => [c.id, { on: c.on, run: c.run }]),
);

/**
 * The single convergence point for trigger backends. The desktop global-shortcut
 * plugin and the browser keydown manager both emit raw `(commandId,
 * edge)` pairs into here, so neither reimplements the `on` filter: an edge the
 * command does not subscribe to is dropped, the rest reach the handler. Direct
 * invocations (command palette, in-app buttons) bypass this and call
 * `commandRunners` with no edge.
 */
export function dispatchCommandTrigger(
	app: TironianApp,
	commandId: string,
	state: ShortcutEventState,
) {
	const target = triggerTargetById.get(commandId);
	if (!target?.on.includes(state)) return;
	target.run(app, state);
}
