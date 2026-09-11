#!/usr/bin/env node

/**
 * @fileoverview Version stamping utility for the Tironian monorepo.
 *
 * Stamps a version number into all package.json, tauri.conf.json, and Cargo.toml
 * files. Discovers files via glob: no hardcoded list.
 *
 * Git operations (commit, tag, push) are handled by CI, not this script.
 *
 * Usage: bun run bump-version <new-version>
 * Example: bun run bump-version 8.0.0
 */

import { join } from 'node:path';
import { Glob } from 'bun';

const newVersion = process.argv[2];
if (!newVersion) {
	console.error('Usage: bun run bump-version <new-version>');
	console.error('Example: bun run bump-version 8.0.0');
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
	console.error(
		'Invalid version format. Use semantic versioning (e.g., 8.0.0)',
	);
	process.exit(1);
}

const root = process.cwd();

/** Collect files to stamp via globs. */
async function collectFiles() {
	const patterns: { glob: string; type: 'json' | 'toml' }[] = [
		{ glob: 'package.json', type: 'json' },
		{ glob: 'apps/*/package.json', type: 'json' },
		// packages/*/package.json intentionally excluded — packages use independent
		// semver for npm publishing. Only apps share the monorepo version.
		{ glob: 'apps/*/src-tauri/tauri.conf.json', type: 'json' },
		{ glob: 'apps/*/src-tauri/Cargo.toml', type: 'toml' },
	];

	const files: { path: string; type: 'json' | 'toml' }[] = [];

	for (const { glob: pattern, type } of patterns) {
		const glob = new Glob(pattern);
		for await (const match of glob.scan({ cwd: root })) {
			files.push({ path: match, type });
		}
	}

	return files;
}

const files = await collectFiles();

/** Track the current version before updating. */
let oldVersion: string | null = null;

/**
 * The Cargo `[package] name`, keyed by the Cargo.toml path it came from. Read
 * from the file's own content rather than derived from its directory: the
 * crate name and the directory name are two separate renames (a rename of one
 * does not imply the other), and `cargo update -p` needs the former.
 */
const cargoPackageNames = new Map<string, string>();

for (const { path, type } of files) {
	const fullPath = join(root, path);
	const file = Bun.file(fullPath);
	const content = await file.text();

	switch (type) {
		case 'json': {
			const json = JSON.parse(content);
			if (!oldVersion && json.version) {
				oldVersion = json.version;
			}
			json.version = newVersion;
			await Bun.write(fullPath, `${JSON.stringify(json, null, '\t')}\n`);
			break;
		}
		case 'toml': {
			const versionRegex = /^version\s*=\s*"[\d.]+"/m;
			const match = content.match(versionRegex);
			if (match && !oldVersion) {
				oldVersion = match[0].match(/"([\d.]+)"/)?.[1] ?? null;
			}
			const updated = content.replace(
				versionRegex,
				`version = "${newVersion}"`,
			);
			await Bun.write(fullPath, updated);

			const nameMatch = content.match(/^\[package\]\s*\nname\s*=\s*"([^"]+)"/m);
			const packageName = nameMatch?.[1];
			if (packageName) cargoPackageNames.set(path, packageName);
			break;
		}
	}

	console.log(`Updated ${path}`);
}

/** Update Cargo.lock for each Tauri app. */
const cargoTomls = files.filter((f) => f.type === 'toml');
for (const { path } of cargoTomls) {
	const tauriDir = join(root, path, '..');
	const packageName = cargoPackageNames.get(path);
	if (!packageName) {
		console.error(
			`Could not read [package] name from ${path}; skipping its Cargo.lock.`,
		);
		continue;
	}
	try {
		console.log(`\nUpdating Cargo.lock for ${packageName}...`);
		const proc = Bun.spawn(['cargo', 'update', '-p', packageName], {
			cwd: tauriDir,
			stdout: 'inherit',
			stderr: 'inherit',
		});
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			throw new Error(`cargo update exited with code ${exitCode}`);
		}
		console.log(`Updated Cargo.lock for ${packageName}`);
	} catch (error) {
		console.error(
			`Failed to update Cargo.lock for ${packageName}:`,
			error instanceof Error ? error.message : String(error),
		);
		console.log(
			`  You may need to run: cd ${tauriDir} && cargo update -p ${packageName}`,
		);
	}
}

console.log(`\nVersion bumped from ${oldVersion} to ${newVersion}`);
