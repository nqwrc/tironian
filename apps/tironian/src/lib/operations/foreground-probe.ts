/**
 * The delivery path's one foreground probe, bounded and fail-open at the call
 * boundary.
 *
 * The host command already degrades platform refusals to `unknown`, but the
 * call itself can still reject (a missing capability, a non-Tauri host) or
 * stall: on Windows, UI Automation's focused-element query is a cross-process
 * call, and a hung target application blocks it for the UIA timeout. Delivery
 * must never wait on that, and "a probe failure can never fail a dictation"
 * has to hold at this boundary, not just inside the host, so both a rejection
 * and a timeout collapse to the unknown answer here.
 *
 * Two consumers, one call. The secure-field guard reads `focusedField`; the
 * undo record reads `appId`, so "scratch that" can tell whether the window
 * holding the last dictation is still the window its backspaces would reach.
 * Delivery takes the whole thing once rather than probing twice, because each
 * probe is a cross-process round trip on the path a person is waiting on.
 */
import type { FocusedFieldKind } from '#platform/context';
import { services } from '$lib/services';

const PROBE_TIMEOUT_MS = 1500;

export type ForegroundProbe = {
	focusedField: FocusedFieldKind;
	/** Null whenever the platform, the grant, or the probe itself could not say. */
	appId: string | null;
};

const UNKNOWN: ForegroundProbe = { focusedField: 'unknown', appId: null };

export function probeForegroundContext(): Promise<ForegroundProbe> {
	const probe = services.context.getForegroundContext().then(
		(context): ForegroundProbe => ({
			focusedField: context.focusedField,
			appId: context.appId,
		}),
		() => UNKNOWN,
	);
	const timeout = new Promise<ForegroundProbe>((resolve) => {
		setTimeout(() => resolve(UNKNOWN), PROBE_TIMEOUT_MS);
	});
	return Promise.race([probe, timeout]);
}

/** The guard's half of {@link probeForegroundContext}, for callers that want only it. */
export function probeFocusedField(): Promise<FocusedFieldKind> {
	return probeForegroundContext().then((context) => context.focusedField);
}
