import { expect, test } from 'bun:test';
import type { TironianApp } from './app';
import {
	buildSettingsBundle,
	countBundleCategories,
} from './settings-bundle-build';

const FAKE_SETTINGS: Record<string, unknown> = {
	soundManualStart: true,
	soundManualStop: false,
	soundManualCancel: true,
	soundVadStart: true,
	soundVadCapture: true,
	soundVadStop: true,
	soundTranscriptionComplete: true,
	soundRecipeComplete: true,
	outputTranscriptionClipboard: true,
	commandModeEnabled: true,
	dictionary: ['Kubernetes'],
};

const app = {
	settings: { get: (key: string) => FAKE_SETTINGS[key] },
	snippets: {
		all: [{ id: 's1', trigger: 'brb', replacement: 'be right back' }],
	},
	recipes: {
		all: [
			{
				id: 'r1',
				name: 'Email',
				instructions: 'Make it an email.',
				icon: null,
			},
		],
	},
	appRules: {
		all: [
			{
				id: 'a1',
				name: 'Email app',
				matchWindowsExe: 'olk.exe',
				matchMacosBundleId: null,
				polishInstructions: 'Formal tone.',
				recipeId: 'builtin:email',
				enabled: true,
			},
			{
				id: 'a2',
				name: 'Notes app',
				matchWindowsExe: 'notion.exe',
				matchMacosBundleId: null,
				polishInstructions: null,
				// A user recipe's minted row id: must not travel.
				recipeId: 'r1',
				enabled: true,
			},
		],
	},
} as unknown as TironianApp;

test('app rules travel with builtin recipe ids kept and minted ids nulled', () => {
	const bundle = buildSettingsBundle(
		app,
		{ preferences: [], snippets: false, recipes: false, appRules: true },
		'2026-08-30T00:00:00.000Z',
	);
	expect(bundle.appRules?.map((rule) => rule.recipeId)).toEqual([
		'builtin:email',
		null,
	]);
	expect(bundle.appRules?.[0]).not.toHaveProperty('id');
	expect(countBundleCategories(bundle)).toBe(1);
});

test('includes only checked preference categories, with exactly their keys', () => {
	const bundle = buildSettingsBundle(
		app,
		{
			preferences: ['sounds', 'commandMode'],
			snippets: false,
			recipes: false,
			appRules: false,
		},
		'2026-08-30T00:00:00.000Z',
	);
	expect(Object.keys(bundle.preferences).sort()).toEqual([
		'commandMode',
		'sounds',
	]);
	expect(bundle.preferences.sounds).toEqual({
		soundManualStart: true,
		soundManualStop: false,
		soundManualCancel: true,
		soundVadStart: true,
		soundVadCapture: true,
		soundVadStop: true,
		soundTranscriptionComplete: true,
		soundRecipeComplete: true,
	});
	expect(bundle.preferences.commandMode).toEqual({ commandModeEnabled: true });
});

test('an unchecked table category is absent from the bundle entirely', () => {
	const bundle = buildSettingsBundle(
		app,
		{ preferences: [], snippets: false, recipes: true, appRules: false },
		'2026-08-30T00:00:00.000Z',
	);
	expect(bundle.snippets).toBeUndefined();
	expect(bundle.recipes).toEqual([
		{ name: 'Email', instructions: 'Make it an email.', icon: null },
	]);
});

test('table rows travel without their minted ids', () => {
	const bundle = buildSettingsBundle(
		app,
		{ preferences: [], snippets: true, recipes: true, appRules: false },
		'2026-08-30T00:00:00.000Z',
	);
	expect(bundle.snippets).toEqual([
		{ trigger: 'brb', replacement: 'be right back' },
	]);
	expect(JSON.stringify(bundle)).not.toContain('s1');
});

test('carries the given exportedAt verbatim', () => {
	const bundle = buildSettingsBundle(
		app,
		{ preferences: [], snippets: false, recipes: false, appRules: false },
		'2026-08-30T00:00:00.000Z',
	);
	expect(bundle.version).toBe(1);
	expect(bundle.exportedAt).toBe('2026-08-30T00:00:00.000Z');
});

test('counts preference and table categories together', () => {
	const bundle = buildSettingsBundle(
		app,
		{
			preferences: ['sounds', 'commandMode'],
			snippets: true,
			recipes: false,
			appRules: false,
		},
		'2026-08-30T00:00:00.000Z',
	);
	expect(countBundleCategories(bundle)).toBe(3);
});

test('an empty selection counts as nothing to export', () => {
	const bundle = buildSettingsBundle(
		app,
		{ preferences: [], snippets: false, recipes: false, appRules: false },
		'2026-08-30T00:00:00.000Z',
	);
	expect(countBundleCategories(bundle)).toBe(0);
});
