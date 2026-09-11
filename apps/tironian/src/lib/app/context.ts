import { createContext } from 'svelte';
import type { TironianQueries } from '$lib/queries';
import type { TironianApp } from './app';

/**
 * The ready app as descendants of the fulfilled boot branch see it:
 * the UI-free product namespaces wrapped with Svelte dependency tracking.
 * Operation modules receive this explicitly; components read it from context.
 */
export type TironianContext = {
	app: TironianApp;
	queries: TironianQueries;
};

/**
 * Typed context supplied synchronously by `TironianUiSessionProvider` inside the
 * fulfilled boot branch. The focused getters below are ready-only by
 * construction: nothing outside that branch can reach either dependency.
 */
const [getTironianContext, setTironianContext] =
	createContext<TironianContext>();

export { setTironianContext };

export function getTironianApp() {
	return getTironianContext().app;
}

export function getTironianQueries() {
	return getTironianContext().queries;
}
