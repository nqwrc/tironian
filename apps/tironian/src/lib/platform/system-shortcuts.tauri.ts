import { extractErrorMessage } from 'wellcrafted/error';
import { createLogger } from 'wellcrafted/logger';
import { Err, tryAsync } from 'wellcrafted/result';
import { type Command, commands, dispatchCommandTrigger } from '$lib/commands';
import {
	DEFAULT_GLOBAL_BINDINGS,
	deviceConfig,
} from '$lib/state/device-config.svelte';
import { type ChordRegistration, tauriOnly } from '$lib/tauri.tauri';
import {
	bindingsEqual,
	isRegistrableChord,
	type KeyBinding,
	keyBindingToAccelerator,
} from '$lib/utils/key-binding';
import { validateGlobalBinding } from '$lib/utils/reserved-shortcuts';
import { createShortcuts } from './shortcuts.shared';
import type { CreateSystemShortcuts } from './types';

/**
 * Tauri build of `#platform/system-shortcuts`: system-global chords driven by
 * tauri-plugin-global-shortcut, stored in device-config under
 * `shortcuts.global.*` (never synced across devices). The default bindings live
 * in `DEFAULT_GLOBAL_BINDINGS` because they double as the device-config schema
 * defaults.
 *
 * The reach router (`shortcuts.ts`) composes this with the universal
 * `focusedShortcuts`; the web build of this seam supplies `null` (no system
 * backend), which is how the router caps web at focused reach. See ADR-0052.
 */

const log = createLogger('tironian/system-shortcuts');

const globalKey = (id: Command['id']) => `shortcuts.global.${id}` as const;

/**
 * Device-config validates `keys` structurally as `string[]`, so this read is the
 * boundary that narrows the stored value to `KeyBinding`. The registrability
 * check below rejects any key string the plugin vocabulary cannot spell.
 *
 * A stale persisted binding that is not a registrable plugin chord (a
 * pre-ADR-0117 Fn or modifier-only hold) is sanitized to `null`: it no longer
 * registers, so it reads as unset instead of surfacing "Works everywhere" for a
 * dead gesture or being silently skipped at push time.
 */
function readBinding(id: Command['id']): KeyBinding | null {
	const stored = (deviceConfig.get(globalKey(id)) as KeyBinding | null) ?? null;
	if (stored === null) return null;
	return isRegistrableChord(stored) ? stored : null;
}

export const createSystemShortcuts: CreateSystemShortcuts | null = (app) =>
	createShortcuts({
		read: readBinding,
		getDefault: (id) => DEFAULT_GLOBAL_BINDINGS[id] ?? null,
		write: (id, binding) => deviceConfig.set(globalKey(id), binding),
		// The plugin matches complete chords. Refuse reserved gestures and exact
		// duplicates, while allowing distinct chords that share keys or modifiers.
		findConflict: (id, binding) => {
			const reserved = validateGlobalBinding(binding);
			if (reserved) return { kind: 'reserved', reason: reserved };
			for (const command of commands) {
				if (command.id === id) continue;
				const other = readBinding(command.id);
				if (other && bindingsEqual(other, binding)) {
					return { kind: 'duplicate', commandId: command.id };
				}
			}
			return null;
		},
		syncErrorTitle: 'Error registering global shortcuts',
		async push(entries) {
			// An accelerator can only be registered once, and the host validates the
			// whole replace-all set: one duplicate rejects every registration, so a
			// collision costs the device all its global shortcuts rather than one
			// command. `findConflict` cannot rule that out, because it only guards a
			// write. A shipped default that moves between releases lands underneath a
			// chord the user stored while the default was something else, and nothing
			// revisits that write.
			//
			// So resolve it here, in the user's favour: a binding they picked outranks
			// one that is only this build's default. Their deliberate chord keeps
			// firing, and the command whose default lost reads as unbound until they
			// rebind it.
			const claims = new Map<
				string,
				{ commandId: Command['id']; isDefault: boolean }
			>();
			for (const entry of entries) {
				if (entry.binding === null) continue;
				const accelerator = keyBindingToAccelerator(entry.binding);
				if (accelerator === null) continue;
				const fallback = DEFAULT_GLOBAL_BINDINGS[entry.command.id] ?? null;
				const isDefault =
					fallback !== null && bindingsEqual(entry.binding, fallback);
				const held = claims.get(accelerator);
				if (held) {
					// The first claim keeps the accelerator unless it is only a default
					// and this one is a chord the user picked.
					const heldYields = held.isDefault && !isDefault;
					const unbound = heldYields ? held.commandId : entry.command.id;
					log.info(
						`Global shortcut ${accelerator} is claimed twice; leaving "${unbound}" unbound`,
					);
					if (!heldYields) continue;
				}
				claims.set(accelerator, { commandId: entry.command.id, isDefault });
			}
			const chords: ChordRegistration[] = [...claims].map(
				([accelerator, { commandId }]) => ({ commandId, accelerator }),
			);
			// A plugin registration the OS rejects (a chord another app holds) fails
			// the whole replace-all; surface it instead of partially binding.
			const { error } = await tryAsync({
				try: async () => {
					await tauriOnly.keyboard.registerChords(chords, (commandId, state) =>
						dispatchCommandTrigger(app, commandId, state),
					);
				},
				catch: (cause) =>
					Err({
						name: 'GlobalShortcutRegistrationFailed',
						message: extractErrorMessage(cause),
					}),
			});
			return error ?? null;
		},
	});
