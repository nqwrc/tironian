import { Err, Ok, type Result } from 'wellcrafted/result';
import { type DownloadError, DownloadServiceLive } from '#platform/download';
import type { TironianApp } from '$lib/app/app';

/** Export the current snippet library as one portable JSON file. */
export async function exportSnippets(
	app: TironianApp,
): Promise<Result<{ written: number }, DownloadError>> {
	const rows = app.snippets.all;
	if (rows.length === 0) return Ok({ written: 0 });

	// No id: ids are minted per row (ADR-0206), not portable across stores.
	const payload = rows.map(({ trigger, replacement }) => ({
		trigger,
		replacement,
	}));
	const blob = new Blob([JSON.stringify(payload, null, 2)], {
		type: 'application/json',
	});
	const { error } = await DownloadServiceLive.downloadBlob({
		name: 'snippets.json',
		blob,
	});
	if (error) return Err(error);
	return Ok({ written: rows.length });
}
