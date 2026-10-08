import type {
	FieldReadOutcome,
	FocusedFieldKind,
	ForegroundContext,
} from '$lib/tauri/bindings.gen';

export type { FieldReadOutcome, FocusedFieldKind, ForegroundContext };

export type ContextService = {
	/**
	 * Reports the application in the foreground and whether the focused UI
	 * element is a secure (password) field.
	 *
	 * Sampled at two named moments: recording start decides per-app routing,
	 * and delivery re-samples for the secure-field guard, because the paste
	 * lands wherever focus is at paste time.
	 *
	 * Best-effort and fail-open by contract: every platform refusal (elevated
	 * target window, no frontmost app, missing macOS Accessibility grant)
	 * degrades to `appId: null` / `focusedField: 'unknown'` rather than an
	 * error, so a probe failure can never fail a dictation. Callers treat
	 * `unknown` as "no rule matches, no guard fires".
	 */
	getForegroundContext: () => Promise<ForegroundContext>;
	/**
	 * The span around the text the last observed `write_text` pasted:
	 * `{ before, region, after }` or a refusal. The host holds the target and
	 * every rule (ADR-0271), so this call takes no argument. Never rejects in
	 * the host. Callers must not log, persist, or display the span.
	 */
	readFocusedText: () => Promise<FieldReadOutcome>;
	/** Drops the host's paste target, so no later read can run. */
	endFieldObservation: () => Promise<void>;
};
