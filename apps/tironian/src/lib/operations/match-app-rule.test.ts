import { expect, test } from 'bun:test';
import type { AppRule } from '$lib/workspace';
import { matchAppRule } from './match-app-rule';

const rule = (overrides: Partial<AppRule> & { id: string }): AppRule => ({
	name: 'Rule',
	matchWindowsExe: null,
	matchMacosBundleId: null,
	polishInstructions: null,
	recipeId: null,
	enabled: true,
	trusted: true,
	...overrides,
});

const TERMINAL = rule({
	id: 'r1',
	name: 'Terminal',
	matchWindowsExe: 'wt.exe',
	matchMacosBundleId: 'com.googlecode.iterm2',
});

test('matches the windows exe on windows', () => {
	expect(
		matchAppRule({ appId: 'wt.exe', rules: [TERMINAL], platform: 'windows' }),
	).toBe(TERMINAL);
});

test('matches the bundle id on macos', () => {
	expect(
		matchAppRule({
			appId: 'com.googlecode.iterm2',
			rules: [TERMINAL],
			platform: 'macos',
		}),
	).toBe(TERMINAL);
});

test('matches case-insensitively', () => {
	expect(
		matchAppRule({ appId: 'WT.EXE', rules: [TERMINAL], platform: 'windows' }),
	).toBe(TERMINAL);
});

test('a null platform field never matches on that platform', () => {
	const windowsOnly = rule({ id: 'r2', matchWindowsExe: 'code.exe' });
	expect(
		matchAppRule({
			appId: 'code.exe',
			rules: [windowsOnly],
			platform: 'macos',
		}),
	).toBeNull();
});

test('a disabled rule is skipped', () => {
	const disabled = rule({
		id: 'r3',
		matchWindowsExe: 'wt.exe',
		enabled: false,
	});
	expect(
		matchAppRule({ appId: 'wt.exe', rules: [disabled], platform: 'windows' }),
	).toBeNull();
});

test('an unknown app or platform matches nothing', () => {
	expect(
		matchAppRule({ appId: null, rules: [TERMINAL], platform: 'windows' }),
	).toBeNull();
	expect(
		matchAppRule({ appId: 'wt.exe', rules: [TERMINAL], platform: 'other' }),
	).toBeNull();
	expect(
		matchAppRule({
			appId: 'chrome.exe',
			rules: [TERMINAL],
			platform: 'windows',
		}),
	).toBeNull();
});

test('duplicate identifiers resolve by row id, not table order', () => {
	const first = rule({ id: 'r1', matchWindowsExe: 'wt.exe' });
	const second = rule({ id: 'r2', matchWindowsExe: 'wt.exe' });
	expect(
		matchAppRule({
			appId: 'wt.exe',
			rules: [second, first],
			platform: 'windows',
		}),
	).toBe(first);
});
