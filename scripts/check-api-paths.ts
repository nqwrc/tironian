/**
 * Fail when a hardcoded literal reproduces one of the two host-infrastructure
 * wire paths owned by apps/desktop/src/routes.ts: BOOTSTRAP_ROUTE
 * (`/_tironian/bootstrap`) and LOCAL_BLOB_ROUTE, which composes the local
 * blob path from its own source of truth, packages/blobs/src/webview.ts
 * (LOCAL_BLOB_PATH). Consumers import from there instead of writing the
 * string again.
 *
 * Out of scope: BUILT_IN_ROUTES' `/apps/<id>/` page-routing prefix. One
 * known literal mirror already exists outside routes.ts:
 * apps/tironian/src/lib/platform/base-path.tironian-host.ts:2
 * (`DICTATION_BASE_PATHNAME = '/apps/dictation'`), in @tironian/app, which
 * has no dependency on @tironian/desktop, so it cannot import from
 * apps/desktop/src/routes.ts today. Widening HARDCODED_PATH to cover
 * `/apps/<id>/` would need an allowlist entry for that file, not a straight
 * ban. Nothing here enforces that either literal stays in sync with
 * BUILT_IN_ROUTES.
 *
 * Excluded:
 *   - The modules that own the two checked paths (they ARE the source of
 *     truth): apps/desktop/src/routes.ts and packages/blobs/src/webview.ts.
 *   - *.test.ts / *.test.tsx (mock URL matchers may reference paths verbatim).
 *   - JSDoc/comment lines (descriptive prose, not constructions).
 *   - *.svelte files: isScannedFile only matches .ts/.tsx, so a literal in a
 *     Svelte component is never checked. Pre-existing limit, not specific to
 *     the two paths this check covers.
 *
 * A straight port of the grep pipeline that used to live inline in
 * .github/workflows/ci.format.yml, so the rule is locally runnable:
 * bun run check:api-paths
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

// Resolve the repo root so this runs from any cwd.
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
	encoding: 'utf8',
}).trim();

const SCAN_ROOTS = ['packages', 'apps'];
const EXCLUDED_DIRS = new Set([
	'node_modules',
	'dist',
	'.wrangler',
	'.next',
	'.svelte-kit',
]);

// A quoted route literal for a path apps/desktop/src/routes.ts owns.
// `([^a-z]|$)` keeps `/api/local-blobsomething` style prefixes from matching.
const HARDCODED_PATH =
	/['"`]\/api\/local-blobs([^a-z]|$)|['"`]\/_tironian\/bootstrap([^a-z]|$)/;

// The next two regexes test the full `path:line:content` record, exactly as
// the workflow's `grep -v` filters did. The record is built with forward
// slashes on every platform (see below), so these stay POSIX.
const ALLOWED_RECORD =
	/packages\/blobs\/src\/webview\.ts|apps\/desktop\/src\/routes\.ts/;
const COMMENT_RECORD = /^[^:]+:[0-9]+:[ \t\v\f\r]*(\*|\/\/|\/\*)/;

const isScannedFile = (name: string): boolean =>
	(name.endsWith('.ts') || name.endsWith('.tsx')) &&
	!name.endsWith('.test.ts') &&
	!name.endsWith('.test.tsx');

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (EXCLUDED_DIRS.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(path);
		else if (entry.isFile() && isScannedFile(entry.name)) yield path;
	}
}

const violations: string[] = [];
let scanned = 0;
for (const scanRoot of SCAN_ROOTS) {
	const dir = join(root, scanRoot);
	if (!existsSync(dir)) continue;
	for (const path of walk(dir)) {
		scanned += 1;
		const lines = readFileSync(path, 'utf8').split('\n');
		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i] as string;
			if (!HARDCODED_PATH.test(line)) continue;
			// Separators normalized before the record is built. `join` yields
			// backslashes on Windows, and the allowlist below is a POSIX-path
			// regex, so without this the two files that ARE the source of truth
			// fail their own check on Windows and pass on Linux CI.
			const relative = `${scanRoot}${path.slice(dir.length)}`
				.split(sep)
				.join('/');
			const record = `${relative}:${i + 1}:${line}`;
			if (ALLOWED_RECORD.test(record)) continue;
			if (COMMENT_RECORD.test(record)) continue;
			violations.push(record);
		}
	}
}

if (violations.length === 0) {
	console.log(
		`check:api-paths: ${scanned} files scanned, no hardcoded API path literals.`,
	);
	process.exit(0);
}

console.error(`check:api-paths: ${violations.length} violation(s):\n`);
for (const record of violations) {
	console.error(`  ${record}`);
}
console.error(
	'\n::error::Hardcoded API path literal found. Import BOOTSTRAP_ROUTE or\n' +
		'LOCAL_BLOB_ROUTE from apps/desktop/src/routes.ts (or LOCAL_BLOB_PATH\n' +
		'from @tironian/blobs/webview) instead.',
);
process.exit(1);
