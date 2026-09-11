/**
 * Dev port and, for an app that still has one, canonical production URL for
 * every Epicenter app this workspace still declares. Tironian ships no
 * hosted deployment of its own, so `WHISPERING` carries only the dev port
 * `workspaceAppViteConfig` binds to.
 *
 * To add an app: add an entry here. TypeScript enforces that every
 * consumer picks it up automatically.
 */
export const APPS = {
	SH: { port: 5173, url: 'https://epicenter.sh' },
	WHISPERING: { port: 1420 },
	HONEYCRISP: { port: 5175, url: 'https://honeycrisp.epicenter.so' },
	VOCAB: { port: 8888, url: 'https://vocab.epicenter.so' },
} as const;
