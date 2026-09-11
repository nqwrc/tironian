/**
 * jsrepo registry config for Tironian app blocks.
 *
 * Each app under apps/<app>/blocks/ contributes recipe blocks that consumers
 * copy into their own tree with `bunx jsrepo add tironian/<app>/<recipe>`.
 * The blocks depend on the npm primitives in @tironian/data, the
 * @tironian/<app> schema package root, and friends; consumers install those
 * normally. The blocks themselves are owned by the consumer once copied.
 */

import { defineConfig, js, repository } from 'jsrepo';

/**
 * Each app contributes one item per file under `apps/<app>/blocks/`.
 *
 * `workspace.ts` (schema + actions) and `daemon-route.ts` (the long-lived
 * writer) ship for every app. Scripts are not recipes: a script is a
 * user-owned Bun file that reads the local SQLite materializer. There is no
 * daemon write path; writes go through an app or an in-process tool surface
 * (ADR-0112).
 */

const BLOCKS = {} as const;

export default defineConfig({
	languages: [js()],
	registry: {
		name: 'tironian',
		version: 'package',
		repository: 'https://github.com/nqwrc/tironian',
		items: Object.entries(BLOCKS).flatMap(([app, blocks]) =>
			blocks.map((block) => ({
				name: `tironian/${app}/${block}`,
				type: 'block',
				files: [{ path: `apps/${app}/blocks/${block}.ts` }],
			})),
		),
		outputs: [repository()],
	},
});
