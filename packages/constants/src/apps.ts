/**
 * Dev port and, for an app that still has one, canonical production URL for
 * every app this workspace still declares. Tironian ships no hosted
 * deployment of its own, so `TIRONIAN` carries only the dev port
 * `workspaceAppViteConfig` binds to.
 *
 * To add an app: add an entry here. TypeScript enforces that every
 * consumer picks it up automatically.
 */
export const APPS = {
	TIRONIAN: { port: 1420 },
} as const;
