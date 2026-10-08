/**
 * The correction learner's one field read, bounded and collapsed to two
 * answers. Any refusal, rejection, or stall is `unavailable`, and the learner
 * treats that as "learn nothing": there is no error to show for a lesson not
 * taken (ADR-0271). The span is returned to exactly one caller and must not be
 * logged, stored, or put in a notice.
 *
 * The context service is an argument, so this module has no runtime `$lib`
 * import and its test mocks no module.
 */
import type { ContextService } from '$lib/services/context/types';

const READ_TIMEOUT_MS = 1500;

/** The two host calls the learner makes. Production passes `services.context`. */
export type FieldContext = Pick<
	ContextService,
	'readFocusedText' | 'endFieldObservation'
>;

export type FieldRead =
	| { kind: 'span'; before: string; region: string; after: string }
	| { kind: 'unavailable' };

const UNAVAILABLE: FieldRead = { kind: 'unavailable' };

export function readPastedField(context: FieldContext): Promise<FieldRead> {
	const read = context.readFocusedText().then(
		(outcome): FieldRead =>
			outcome.kind === 'span'
				? {
						kind: 'span',
						before: outcome.before,
						region: outcome.region,
						after: outcome.after,
					}
				: UNAVAILABLE,
		() => UNAVAILABLE,
	);
	const timeout = new Promise<FieldRead>((resolve) => {
		setTimeout(() => resolve(UNAVAILABLE), READ_TIMEOUT_MS);
	});
	return Promise.race([read, timeout]);
}

/** Fire-and-forget: a host that cannot hear this lets the target expire. */
export function endFieldObservation(context: FieldContext): void {
	void context.endFieldObservation().then(undefined, () => undefined);
}
