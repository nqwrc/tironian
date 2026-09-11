/**
 * What a person can launch from Epicenter Home (ADR-0189).
 *
 * A compiled application ships in the release and is served from its own
 * built-in route behind the host's session gate. Home is not in the list, for
 * a smaller reason than it used to be: you are already looking at it, so
 * launching it is a no-op rather than a window (ADR-0209).
 */

import { BUILT_IN_ROUTES } from './routes.ts';

/** One application a person can launch, however the host serves it. */
export type Application = {
	id: string;
	title: string;
};

/**
 * The compiled applications this release can launch.
 *
 * Rust holds the matching decision for its own built-in app table
 * (`BuiltInApp::is_launchable`). Both sides are small closed lists rather than a
 * shared manifest, and each is checked against this one by its own tests.
 */
export const WHISPERING_APPLICATION: Application = {
	id: BUILT_IN_ROUTES.whispering.id,
	title: BUILT_IN_ROUTES.whispering.title,
};

/**
 * Compiled applications, in the order Home lists them.
 *
 * This is also the list the host loads asset trees for at boot: a compiled
 * application is exactly a `dist/<id>` build the release ships, so declaring
 * one here and building it are the two halves of the same act.
 */
export const COMPILED_APPLICATIONS: readonly Application[] = [
	WHISPERING_APPLICATION,
];
