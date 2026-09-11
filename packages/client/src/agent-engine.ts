/**
 * The fetch an engine calls: a function from a URL plus init to a response.
 * Structurally `@tironian/auth`'s `AuthFetch` and a plain `globalThis.fetch`,
 * but typed as the function shape rather than `typeof globalThis.fetch` because
 * the engine never needs `fetch.preconnect`, and an authed fetch wrapper (which
 * is what the gateway path passes) does not carry it. This is purely how the
 * engine reaches the wire, so it stays here rather than in the shared contract.
 */
export type EngineFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;
