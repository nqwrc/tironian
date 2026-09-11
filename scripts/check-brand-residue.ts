/**
 * Brand Residue Check
 *
 * Tironian is a modified version of an upstream project whose names must not
 * reach a person or a code path in this repository, except where a license
 * requires them: copyright lines, license texts, and the "modified version"
 * notices. This check lists every tracked occurrence of those names outside
 * the allowlist, so "no upstream names left" is a number anyone can reproduce,
 * not a claim.
 *
 * The allowlist is `scripts/brand-residue-allowlist.txt`. Each entry is either
 * a path glob (every line in matching files is allowed) or `path::substring`
 * (only lines in that file containing the substring are allowed). Anything the
 * AGPL-3.0 or MIT does not require stays off it.
 *
 * Exit code 1 when any occurrence falls outside the allowlist.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PATTERN = /epicenter|whispering|honeycrisp/i;
const NUL = String.fromCharCode(0);

type Entry = { glob: RegExp; substring: string | null };

/** `**` matches across directories, `*` within one path segment. */
function globToRegExp(glob: string): RegExp {
	const escaped = glob
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.split('**')
		.map((part) => part.replace(/\*/g, '[^/]*'))
		.join('.*');
	return new RegExp(`^${escaped}$`);
}

function readAllowlist(): Entry[] {
	const text = readFileSync(
		join(ROOT, 'scripts/brand-residue-allowlist.txt'),
		'utf8',
	);
	const entries: Entry[] = [];
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (line === '' || line.startsWith('#')) continue;
		const separator = line.indexOf('::');
		const path = separator === -1 ? line : line.slice(0, separator).trim();
		const substring =
			separator === -1 ? null : line.slice(separator + 2).trim();
		entries.push({ glob: globToRegExp(path), substring });
	}
	return entries;
}

function trackedFiles(): string[] {
	const result = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: ROOT });
	return new TextDecoder()
		.decode(result.stdout)
		.split(NUL)
		.filter((path) => path !== '');
}

const allowlist = readAllowlist();
const allowedFile = (path: string) =>
	allowlist.some((entry) => entry.substring === null && entry.glob.test(path));
const allowedLine = (path: string, line: string) =>
	allowlist.some(
		(entry) =>
			entry.substring !== null &&
			entry.glob.test(path) &&
			line.includes(entry.substring),
	);

const hits: string[] = [];
for (const path of trackedFiles()) {
	if (allowedFile(path)) continue;
	if (PATTERN.test(path)) hits.push(`${path}  (path)`);
	let text: string;
	try {
		text = readFileSync(join(ROOT, path), 'utf8');
	} catch {
		continue;
	}
	// Binary files: a NUL byte never appears in text this check cares about.
	if (text.includes(NUL)) continue;
	const lines = text.split('\n');
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? '';
		if (PATTERN.test(line) && !allowedLine(path, line)) {
			hits.push(`${path}:${index + 1}  ${line.trim().slice(0, 120)}`);
		}
	}
}

if (hits.length > 0) {
	const verbose = process.argv.includes('--verbose');
	console.log(hits.slice(0, verbose ? hits.length : 50).join('\n'));
	if (!verbose && hits.length > 50) {
		console.log(`... ${hits.length - 50} more (--verbose)`);
	}
	console.log(
		`\ncheck:brand-residue: ${hits.length} occurrence(s) outside the allowlist.`,
	);
	process.exit(1);
}
console.log('check:brand-residue: no upstream names outside the allowlist.');
