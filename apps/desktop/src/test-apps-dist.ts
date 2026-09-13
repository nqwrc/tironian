/**
 * The release asset layout a test host serves: one built document per
 * compiled application this release declares.
 *
 * Fixtures derive their application directories from
 * {@link COMPILED_APPLICATIONS} instead of listing them, because
 * `loadStaticAssets` refuses to start when a declared application did not
 * build. Without this, admitting a compiled application would fail every host
 * test at once for a reason none of them is about.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Application, COMPILED_APPLICATIONS } from './applications.ts';

export function writeAppsDist({
	root = mkdtempSync(join(tmpdir(), 'tironian-apps-dist-')),
	applicationPage,
}: {
	root?: string;
	applicationPage(application: Application): string;
}): string {
	for (const application of COMPILED_APPLICATIONS) {
		mkdirSync(join(root, application.id), { recursive: true });
		writeFileSync(
			join(root, application.id, 'index.html'),
			applicationPage(application),
		);
	}
	return root;
}
