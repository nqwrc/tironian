#!/usr/bin/env bun
/** Remove generated trusted-SPA assets before composing a fresh desktop build. */

import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Every entry, not a per-application allowlist: a deleted app (Query,
// Honeycrisp) that never got its own removal step here would otherwise leave
// a stale build behind, and `tauri build` bundles anything it finds under
// `../dist` (tauri.conf.json's `apps-dist` resource mapping) regardless of
// whether the app that produced it still exists. `.gitkeep` is the one
// tracked file in this otherwise gitignored directory, kept so the directory
// exists on a fresh clone before the first build; it stays.
const dist = join(import.meta.dir, '..', 'dist');
const entries = await readdir(dist).catch(() => []);
await Promise.all(
	entries
		.filter((entry) => entry !== '.gitkeep')
		.map((entry) => rm(join(dist, entry), { recursive: true, force: true })),
);
