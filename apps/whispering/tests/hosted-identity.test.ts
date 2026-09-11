/**
 * Hosted SPA identity tests.
 *
 * Whispering is one SPA with browser and Epicenter build environments. It keeps
 * its app routes and platform adapters, while Epicenter owns the native
 * desktop identity.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	normalizeWhisperingPath,
	whisperingPath,
} from '../src/lib/constants/urls';

const ROOT = join(import.meta.dir, '..');
const REPO_ROOT = join(ROOT, '..', '..');
const read = (name: string) => readFileSync(join(ROOT, name), 'utf8');

describe('Epicenter-hosted Whispering identity', () => {
	test('the canonical package is the independently hostable SPA', () => {
		expect(JSON.parse(read('package.json')).name).toBe('@epicenter/whispering');
		expect(existsSync(join(ROOT, 'src-tauri'))).toBe(false);
		expect(existsSync(join(REPO_ROOT, 'apps/epicenter/whispering'))).toBe(
			false,
		);
		expect(existsSync(join(REPO_ROOT, 'apps/epicenter/src-tauri'))).toBe(true);
	});

	test('the browser and Epicenter builds own distinct base paths and outputs', () => {
		const config = read('svelte.config.js');
		const vite = read('vite.config.ts');
		expect(config).toContain("pages: '../epicenter/dist/whispering'");
		expect(config).toContain("paths: { base: '/apps/whispering' }");
		expect(vite).toContain("process.env.TIRONIAN_HOST === '1'");
		expect(vite).not.toContain('TAURI_ENV_PLATFORM');
		expect(vite).not.toContain('TAURI_DEV_HOST');
		expect(read('src/lib/platform/base-path.browser.ts')).toContain(
			"WHISPERING_BASE_PATHNAME = ''",
		);
		expect(read('src/lib/platform/base-path.tironian-host.ts')).toContain(
			"WHISPERING_BASE_PATHNAME = '/apps/whispering'",
		);
		expect(whisperingPath('/')).toBe('/');
		expect(whisperingPath('/recording-overlay')).toBe('/recording-overlay');
		expect(normalizeWhisperingPath('/settings')).toBe('/settings');
	});

	test('the canonical SPA no longer documents the retired native identifier', () => {
		expect(read('src/lib/services/fs-paths.ts')).not.toContain(
			'app.tironian.dictation',
		);
		expect(read('src/lib/services/fs-paths.ts')).toContain('app.tironian');
	});

	test('there is no sign-in seam left to build a platform leaf for', () => {
		expect(
			existsSync(join(ROOT, 'src/lib/platform/auth.tironian-host.ts')),
		).toBe(false);
		expect(existsSync(join(ROOT, 'src/lib/platform/auth.browser.ts'))).toBe(
			false,
		);
		// Built from parts so this file has no reachable-looking mention of the
		// retired platform seam itself.
		const retiredCondition = ['#platform', 'auth'].join('/');
		expect(JSON.parse(read('package.json')).imports[retiredCondition]).toBe(
			undefined,
		);
	});
});
