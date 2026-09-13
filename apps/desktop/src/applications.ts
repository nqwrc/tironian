/**
 * The compiled applications this host serves.
 *
 * A compiled application ships in the release and is served from its own
 * built-in route behind the host's session gate. There is one, and it is the
 * app's only window (ADR-0245).
 */

import { BUILT_IN_ROUTES } from './routes.ts';

/** One application the host serves, however it is built. */
export type Application = {
	id: string;
	title: string;
};

/**
 * The dictation app.
 *
 * Rust holds the matching entry in its own built-in app table (`BuiltInApp`).
 * Both sides are small closed lists rather than a shared manifest, and each is
 * checked against this one by its own tests.
 */
export const DICTATION_APPLICATION: Application = {
	id: BUILT_IN_ROUTES.dictation.id,
	title: BUILT_IN_ROUTES.dictation.title,
};

/**
 * Compiled applications, in release order.
 *
 * This is also the list the host loads asset trees for at boot: a compiled
 * application is exactly a `dist/<id>` build the release ships, so declaring
 * one here and building it are the two halves of the same act.
 */
export const COMPILED_APPLICATIONS: readonly Application[] = [
	DICTATION_APPLICATION,
];
