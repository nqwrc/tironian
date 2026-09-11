/**
 * Writes a settings bundle to a file the person chooses.
 *
 * The thin I/O half of the export: `buildSettingsBundle` in
 * `settings-bundle-build.ts` does the shaping and is where the tests live. This
 * file supplies the real timestamp and reaches the platform download seam, the
 * same split `snippets-export.ts` already uses.
 */

import { Err, Ok, type Result } from 'wellcrafted/result';
import { type DownloadError, DownloadServiceLive } from '#platform/download';
import type { TironianApp } from './app';
import {
	buildSettingsBundle,
	countBundleCategories,
} from './settings-bundle-build';
import type { SettingsBundleSelection } from './settings-bundle-types';

export const SETTINGS_BUNDLE_FILE_NAME = 'tironian-settings.json';

export async function exportSettingsBundle(
	app: TironianApp,
	selection: SettingsBundleSelection,
): Promise<Result<{ categoryCount: number }, DownloadError>> {
	const bundle = buildSettingsBundle(app, selection, new Date().toISOString());
	const categoryCount = countBundleCategories(bundle);
	// Nothing checked is not a failure, so there is no dialog to open either.
	if (categoryCount === 0) return Ok({ categoryCount: 0 });

	const blob = new Blob([JSON.stringify(bundle, null, 2)], {
		type: 'application/json',
	});
	const { error } = await DownloadServiceLive.downloadBlob({
		name: SETTINGS_BUNDLE_FILE_NAME,
		blob,
	});
	if (error) return Err(error);
	return Ok({ categoryCount });
}
