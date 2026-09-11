import type {
	FocusedFieldKind,
	ForegroundContext,
} from '$lib/tauri/bindings.gen';

export type { FocusedFieldKind, ForegroundContext };

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
};
