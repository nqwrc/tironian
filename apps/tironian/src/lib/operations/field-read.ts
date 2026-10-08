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

/**
 * `generation` names the host's paste target the read was for. A refusal
 * carries it when a target existed; a rejection or a stall never does.
 */
export type FieldRead =
	| {
			kind: 'span';
			generation: number;
			before: string;
			region: string;
			after: string;
	  }
	| { kind: 'unavailable'; generation: number | null };

const NO_ANSWER: FieldRead = { kind: 'unavailable', generation: null };

export function readPastedField(context: FieldContext): Promise<FieldRead> {
	const read = context.readFocusedText().then(
		(outcome): FieldRead =>
			outcome.kind === 'span'
				? {
						kind: 'span',
						generation: outcome.generation,
						before: outcome.before,
						region: outcome.region,
						after: outcome.after,
					}
				: { kind: 'unavailable', generation: outcome.generation },
		() => NO_ANSWER,
	);
	const timeout = new Promise<FieldRead>((resolve) => {
		setTimeout(() => resolve(NO_ANSWER), READ_TIMEOUT_MS);
	});
	return Promise.race([read, timeout]);
}

/**
 * Fire-and-forget: a host that cannot hear this lets the target expire. With
 * no generation the observation never learned which target was its own, and
 * clearing blindly could cancel the next dictation's, so it lets it expire too.
 */
export function endFieldObservation(
	context: FieldContext,
	generation: number | null,
): void {
	if (generation === null) return;
	void context.endFieldObservation(generation).then(undefined, () => undefined);
}
