/**
 * The secure-field guard's one decision, as a pure function.
 *
 * Detection lives in the host (`get_foreground_context`); this module only
 * decides what a verdict means. Fail-open by design: `unknown` and
 * `notSecure` always pass, because the platform probes are flaky exactly
 * where users live (elevated windows, remote desktop, some Electron apps),
 * and a guard that randomly refuses delivery kills trust in the whole app.
 * Only an affirmative `secure` verdict withholds, and only while the guard
 * is enabled. Defense-in-depth against the common accident of dictating
 * into a password box, not a security boundary; the honest copy on the
 * Privacy & Processing toggle says so.
 */
import type { FocusedFieldKind } from '#platform/context';

export type SecureFieldGuardDecision = 'allow' | 'withhold';

export function decideSecureFieldGuard({
	focusedField,
	enabled,
}: {
	focusedField: FocusedFieldKind;
	enabled: boolean;
}): SecureFieldGuardDecision {
	return enabled && focusedField === 'secure' ? 'withhold' : 'allow';
}
