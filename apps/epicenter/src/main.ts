/**
 * The Bun sidecar entrypoint: accept one versioned boot frame from Rust, bind
 * its validated loopback port, announce readiness once, and remain tied to the
 * parent stdin pipe for the lifetime of the desktop application.
 */

import { join } from 'node:path';
import { createBunBlobStore } from '@epicenter/blobs/bun';
import { createBunBlobRemote, createEpicenterClient } from '@epicenter/client';
import { epicenterDataRoot } from '@epicenter/constants/app-data';
import { extractErrorMessage } from 'wellcrafted/error';
import { COMPILED_APPLICATIONS } from './applications.ts';
import {
	createDesktopAuthAuthority,
	type DesktopAuthAuthority,
} from './desktop-auth-authority.ts';
import { createDesktopAuthorityFetch } from './desktop-authority-fetch.ts';
import { createHomeServer } from './server.ts';
import {
	createNativeAuthPort,
	createReadyFrame,
	parseBootFrame,
	parseRuntimeMode,
	superviseSidecar,
	watchParentPipe,
} from './sidecar-runtime.ts';
import { loadStaticAssets } from './static-assets.ts';

async function main(): Promise<void> {
	const parentPipe = watchParentPipe(Bun.stdin.stream());
	let desktopAuth: DesktopAuthAuthority | undefined;
	let server: ReturnType<typeof Bun.serve> | undefined;
	let lifecycleOwnsResources = false;

	try {
		const runtimeMode = parseRuntimeMode(Bun.argv);
		const boot = parseBootFrame(await parentPipe.bootLine, runtimeMode);
		const nativeAuthPort = createNativeAuthPort({ parentPipe });
		const auth = createDesktopAuthAuthority({
			authCell: boot.authCell,
			nativeAuthPort,
		});
		desktopAuth = auth;

		// The one Epicenter root, resolved here rather than received. A desktop
		// host and a CLI that each computed this path would have to agree on it
		// exactly, so one TypeScript function owns it and everything else calls
		// that (ADR-0201). `blobs` below it is the host's own name, and
		// everything under `apps/` is somebody else's.
		//
		// There is no `data/` any more. The host used to open a store there, sync
		// it, render it to markdown, project it to SQLite and serve it raw; every
		// one of those read application data the host had no business holding
		// (ADR-0226), and the applications on the store each own their own now
		// (ADR-0227).
		const dataRoot = epicenterDataRoot();

		const blobs = createBunBlobStore({
			directory: join(dataRoot, 'blobs'),
		});
		// Identity is immutable per process generation, so remote availability
		// is a boot-time fact: a signed-in generation composes the streaming
		// remote over the authority's own deployment fetch, a signed-out one
		// has none until sign-in relaunches the app.
		const blobRemote =
			auth.bootSnapshot.state.status === 'signed-in'
				? createBunBlobRemote({
						store: blobs,
						client: createEpicenterClient({
							baseURL: auth.baseURL,
							fetch: createDesktopAuthorityFetch(auth),
						}),
					})
				: null;

		const appsDist = process.env.EPICENTER_APPS_DIST;
		if (!appsDist) {
			throw new Error(
				'EPICENTER_APPS_DIST must name the release-built Epicenter applications directory.',
			);
		}
		const staticAssets = await loadStaticAssets(
			appsDist,
			COMPILED_APPLICATIONS,
		);
		const origin = `http://127.0.0.1:${boot.port}`;
		const app = createHomeServer({
			origin,
			launchToken: boot.token,
			staticAssets,
			blobs,
			desktopAuth: auth,
			blobRemote,
		});

		server = Bun.serve({
			// The Rust-owned port has already passed the mode-specific policy.
			hostname: '127.0.0.1',
			port: boot.port,
			fetch: app.fetch,
		});
		process.stdout.write(`${JSON.stringify(createReadyFrame(boot.port))}\n`);
		lifecycleOwnsResources = true;
		const ownedDesktopAuth = auth;
		await superviseSidecar({
			server,
			host: {
				async [Symbol.asyncDispose]() {
					ownedDesktopAuth[Symbol.dispose]();
				},
			},
			parentPipe,
			protocol: nativeAuthPort,
		});
	} finally {
		if (!lifecycleOwnsResources) {
			if (server) await server.stop(true);
			desktopAuth?.[Symbol.dispose]();
			await parentPipe.cancel();
		}
	}
}

try {
	await main();
} catch (error) {
	// Opening the store is part of boot, and it reports its refusals by throwing
	// what a `defineErrors` factory produced. Those are plain objects, so an
	// `instanceof Error` test would print `[object Object]` for exactly the
	// failure an operator most needs spelled out.
	console.error(extractErrorMessage(error));
	process.exitCode = 1;
}
