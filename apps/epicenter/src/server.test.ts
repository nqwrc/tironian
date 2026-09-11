/**
 * Home Server Tests
 *
 * Verifies the loopback shell every trusted document and API sits behind
 * (ADR-0084): the exact Host and Origin checks protect the loopback boundary,
 * Tauri bootstraps HttpOnly browser sessions without a URL token, and Home and
 * Whispering are served at their final routes.
 *
 * Key behaviors:
 * - The launch token is accepted only by the bootstrap route
 * - Domain APIs (local blobs, the account broker) require an HttpOnly browser
 *   session
 * - Home and Whispering serve their builds
 * - Unknown, non-canonical, and traversal-shaped app paths stay closed
 * - Host, Origin, CSP, frame, and referrer policies are enforced
 * - The real vite build emits one document with no external asset references
 * - The spawned `main.ts` sidecar announces versioned readiness and serves
 *   the built SPA
 */

import { describe, expect, test } from 'bun:test';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	type BlobRemote,
	BlobRemoteError,
	generateBlobId,
} from '@epicenter/blobs';
import { createBunBlobStore } from '@epicenter/blobs/bun';
import { desktopBlobUrl } from '@epicenter/blobs/webview';
import { Ok } from 'wellcrafted/result';
import { COMPILED_APPLICATIONS } from './applications.ts';
import {
	ACCOUNT_INSTANCE_ROUTE,
	ACCOUNT_PROFILE_ROUTE,
	ACCOUNT_SIGN_OUT_ROUTE,
	BOOTSTRAP_ROUTE,
	BUILT_IN_ROUTES,
	HOME_ROUTE,
	WHISPERING_ROUTE,
} from './routes.ts';
import { createHomeServer } from './server.ts';
import type { ReadyFrame } from './sidecar-runtime.ts';
import {
	type EpicenterStaticAssets,
	loadStaticAssets,
} from './static-assets.ts';
import { writeAppsDist } from './test-apps-dist.ts';
import { createTestDesktopAuth } from './test-home-host.ts';

const TOKEN = 'per-launch-secret';

/** A stand-in for the built SPA document; `/` must return it byte-for-byte. */
const PAGE = '<!doctype html><html><body>Home test page</body></html>';
const applicationPage = (title: string) =>
	`<!doctype html><html><body>${title} test application</body></html>`;
const WHISPERING_PAGE = applicationPage('Tironian');

/** Parse a Content-Security-Policy header into directive name to its token list. */
function cspDirectives(header: string | null): Map<string, string[]> {
	const directives = new Map<string, string[]>();
	for (const directive of (header ?? '').split(';')) {
		const [name, ...tokens] = directive.trim().split(/\s+/);
		if (name !== undefined && name !== '') directives.set(name, tokens);
	}
	return directives;
}

/** Strip what the host stamps onto an app window, recovering the built page. */
function withoutAuthBootstrap(page: string): string {
	return page.replace(
		/<script id="epicenter-auth-bootstrap" type="application\/json">[\s\S]*?<\/script>/,
		'',
	);
}

const queryDir = fileURLToPath(new URL('..', import.meta.url));
type TestServer = ReturnType<typeof Bun.serve>;
const serverAuthentication = new WeakMap<
	TestServer,
	{ cookie: string; origin: string }
>();

function testDataDir(): string {
	return mkdtempSync(join(tmpdir(), 'query-server-test-'));
}

function createTestBlobs() {
	return createBunBlobStore({ directory: join(testDataDir(), 'blobs') });
}

function boundPort(server: { port?: number }): number {
	if (server.port === undefined) throw new Error('server did not bind a port');
	return server.port;
}

async function serveHost(
	page: string = PAGE,
	blobRemote: BlobRemote | null = null,
) {
	const portProbe = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: () => new Response(),
	});
	const port = boundPort(portProbe);
	await portProbe.stop(true);
	const origin = `http://127.0.0.1:${port}`;
	const app = createHomeServer({
		origin,
		launchToken: TOKEN,
		staticAssets: await createAppsDistFixture(page),
		blobs: createTestBlobs(),
		desktopAuth: createTestDesktopAuth(),
		blobRemote,
	});
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port,
		fetch: app.fetch,
	});
	const bootstrap = await fetch(BOOTSTRAP_ROUTE.url(origin), {
		method: 'POST',
		headers: {
			authorization: `Bearer ${TOKEN}`,
			origin,
		},
	});
	if (bootstrap.status !== 204) {
		throw new Error(`test bootstrap failed with ${bootstrap.status}`);
	}
	const cookie = bootstrap.headers.get('set-cookie')?.split(';', 1)[0];
	if (cookie === undefined) throw new Error('test bootstrap set no cookie');
	serverAuthentication.set(server, { cookie, origin });
	return server;
}

async function createAppsDistFixture(homePage: string = PAGE) {
	return loadStaticAssets(
		writeAppsDistFixture(homePage),
		COMPILED_APPLICATIONS,
	);
}

/** The loaded build of one compiled application, by ID. */
function applicationAssets(assets: EpicenterStaticAssets, id: string) {
	const application = assets.applications.find(
		(candidate) => candidate.id === id,
	);
	if (!application) throw new Error(`no compiled application named ${id}`);
	return application;
}

function writeAppsDistFixture(homePage: string = PAGE): string {
	const root = writeAppsDist({
		homePage,
		applicationPage: ({ title }) => applicationPage(title),
	});
	mkdirSync(join(root, 'whispering', '_app', 'immutable'), { recursive: true });
	mkdirSync(join(root, 'whispering', 'vad'), { recursive: true });
	writeFileSync(
		join(root, 'whispering', '_app', 'immutable', 'entry.js'),
		'window.whisperingLoaded = true;',
	);
	writeFileSync(
		join(root, 'whispering', 'vad', 'silero_vad_v5.onnx'),
		'vad-model',
	);
	// The onnxruntime binary the VAD trigger compiles in the WebView. It belongs
	// in the fixture because a policy that admits WebAssembly is only truthful if
	// the WebAssembly it admits is actually served from this origin.
	writeFileSync(
		join(root, 'whispering', 'vad', 'ort-wasm-simd-threaded.wasm'),
		'\0asm\x01\0\0\0',
	);
	return root;
}

function authenticationFor(server: TestServer) {
	const authentication = serverAuthentication.get(server);
	if (authentication === undefined) throw new Error('unknown test server');
	return authentication;
}

function authenticatedHeaders(server: TestServer) {
	return { cookie: authenticationFor(server).cookie };
}

describe('loadStaticAssets', () => {
	test('every declared compiled application must have built, and so must Home', async () => {
		// One omission at a time, so the message names the application that is
		// actually missing rather than whichever absence lost a race.
		for (const absent of COMPILED_APPLICATIONS) {
			const root = writeAppsDist({
				homePage: PAGE,
				applicationPage: ({ title }) => applicationPage(title),
			});
			rmSync(join(root, absent.id), { recursive: true });
			expect(loadStaticAssets(root, COMPILED_APPLICATIONS)).rejects.toThrow(
				new RegExp(`${absent.title} asset root is missing`),
			);
		}

		const missingHome = writeAppsDist({
			homePage: PAGE,
			applicationPage: ({ title }) => applicationPage(title),
		});
		rmSync(join(missingHome, 'home'), { recursive: true });
		expect(
			loadStaticAssets(missingHome, COMPILED_APPLICATIONS),
		).rejects.toThrow(/Home index is missing/);
	});

	test('resolves nested generated assets and extensionless SPA routes', async () => {
		const assets = await createAppsDistFixture();
		const whispering = applicationAssets(assets, 'whispering');
		const nested = await whispering.resolve(
			'/apps/whispering/_app/immutable/entry.js',
		);
		expect(nested?.contentType).toContain('text/javascript');
		expect(await nested?.file.text()).toContain('whisperingLoaded');

		const vad = await whispering.resolve(
			'/apps/whispering/vad/silero_vad_v5.onnx',
		);
		expect(await vad?.file.text()).toBe('vad-model');

		const fallback = await whispering.resolve(
			'/apps/whispering/settings/transcription',
		);
		expect(await fallback?.file.text()).toBe(WHISPERING_PAGE);
		expect(
			await whispering.resolve('/apps/whispering/_app/missing.js'),
		).toBeUndefined();
	});

	test('rejects raw, encoded, double-encoded, and symlink traversal', async () => {
		const root = writeAppsDistFixture();
		const outside = mkdtempSync(join(tmpdir(), 'epicenter-outside-assets-'));
		writeFileSync(join(outside, 'secret.txt'), 'outside secret');
		symlinkSync(
			join(outside, 'secret.txt'),
			join(root, 'whispering', 'linked-secret.txt'),
		);
		symlinkSync(
			join(outside, 'secret.txt'),
			join(root, 'whispering', 'linked-secret'),
		);
		const assets = await loadStaticAssets(root, COMPILED_APPLICATIONS);
		const whispering = applicationAssets(assets, 'whispering');

		for (const pathname of [
			'/apps/whispering/../home/index.html',
			'/apps/whispering/%2e%2e/home/index.html',
			'/apps/whispering/%252e%252e/home/index.html',
			'/apps/whispering/%2fetc/passwd',
			'/apps/whispering/%252fetc/passwd',
			'/apps/whispering//etc/passwd',
			'/apps/whispering/..\\query\\index.html',
			'/apps/whispering/%00index.html',
			'/apps/whispering/linked-secret.txt',
			'/apps/whispering/linked-secret',
		]) {
			expect(await whispering.resolve(pathname)).toBeUndefined();
		}
	});
});

describe('createHomeServer', () => {
	test('refuses an empty launch token and non-loopback origins', async () => {
		const staticAssets = await createAppsDistFixture();
		const desktopAuth = createTestDesktopAuth();
		expect(() =>
			createHomeServer({
				origin: 'http://127.0.0.1:39130',
				launchToken: '',
				staticAssets,
				blobs: createTestBlobs(),
				desktopAuth,
				blobRemote: null,
			}),
		).toThrow(/launch token/);
		for (const origin of [
			'http://localhost:39130',
			'https://127.0.0.1:39130',
			'http://127.0.0.1',
			'http://127.0.0.1:39130/path',
		]) {
			expect(() =>
				createHomeServer({
					origin,
					launchToken: TOKEN,
					staticAssets,
					blobs: createTestBlobs(),
					desktopAuth,
					blobRemote: null,
				}),
			).toThrow(/exact http:\/\/127\.0\.0\.1/);
		}
	});

	test('the launch token mints a browser session only at bootstrap', async () => {
		const server = await serveHost();
		const { origin } = authenticationFor(server);
		try {
			const minted = await fetch(BOOTSTRAP_ROUTE.url(origin), {
				method: 'POST',
				headers: { authorization: `Bearer ${TOKEN}`, origin },
			});
			const setCookie = minted.headers.get('set-cookie');
			expect(minted.status).toBe(204);
			expect(setCookie).toContain('HttpOnly');
			expect(setCookie).toContain('SameSite=Strict');
			expect(setCookie).toContain('Path=/');
			expect(setCookie).not.toContain(TOKEN);

			const wrongToken = await fetch(BOOTSTRAP_ROUTE.url(origin), {
				method: 'POST',
				headers: { authorization: 'Bearer wrong', origin },
			});
			expect(wrongToken.status).toBe(401);
			const wrongOrigin = await fetch(BOOTSTRAP_ROUTE.url(origin), {
				method: 'POST',
				headers: {
					authorization: `Bearer ${TOKEN}`,
					origin: 'http://localhost:39130',
				},
			});
			expect(wrongOrigin.status).toBe(403);
		} finally {
			await server.stop(true);
		}
	});

	test('serves only the session shell before bootstrap and gates domain APIs', async () => {
		const server = await serveHost();
		try {
			const shell = await fetch(HOME_ROUTE.url(server.url.origin));
			expect(shell.status).toBe(200);
			expect(await shell.text()).toContain('__EPICENTER_SESSION_READY__');
			expect(shell.headers.get('cache-control')).toBe('no-store');
			const page = await fetch(HOME_ROUTE.url(server.url.origin), {
				headers: authenticatedHeaders(server),
			});
			expect(withoutAuthBootstrap(await page.text())).toBe(PAGE);

			// The host owns no chat session or app catalog any more (ADR-0226):
			// the routes those used to answer at are simply gone, not just gated.
			const oldSession = await fetch(`${server.url.origin}/api/home/session`);
			expect(oldSession.status).toBe(404);
			const oldApps = await fetch(`${server.url.origin}/api/apps`);
			expect(oldApps.status).toBe(404);
			const oldTools = await fetch(`${server.url.origin}/api/tools`);
			expect(oldTools.status).toBe(404);
			const oldWs = await fetch(`${server.url.origin}/ws`);
			expect(oldWs.status).toBe(404);
		} finally {
			await server.stop(true);
		}
	});

	test('serves Home and every compiled application', async () => {
		const server = await serveHost();
		try {
			expect(
				Object.values(BUILT_IN_ROUTES).map(({ id, pattern }) => ({
					id,
					pattern,
				})),
			).toEqual([
				{ id: 'home', pattern: '/apps/home/' },
				{ id: 'whispering', pattern: '/apps/whispering/' },
			]);

			const query = await fetch(HOME_ROUTE.url(server.url.origin), {
				headers: authenticatedHeaders(server),
			});
			const queryPage = await query.text();
			expect(queryPage).toContain('id="epicenter-auth-bootstrap"');
			expect(withoutAuthBootstrap(queryPage)).toBe(PAGE);

			const whispering = await fetch(WHISPERING_ROUTE.url(server.url.origin), {
				headers: authenticatedHeaders(server),
			});
			const whisperingPage = await whispering.text();
			expect(whisperingPage).toContain('id="epicenter-auth-bootstrap"');
			expect(withoutAuthBootstrap(whisperingPage)).toBe(WHISPERING_PAGE);
			const whisperingAsset = await fetch(
				`${server.url.origin}/apps/whispering/_app/immutable/entry.js?v=1`,
				{ headers: authenticatedHeaders(server) },
			);
			expect(await whisperingAsset.text()).toContain('whisperingLoaded');
			expect(whisperingAsset.headers.get('content-type')).toContain(
				'text/javascript',
			);
			const vadAsset = await fetch(
				`${server.url.origin}/apps/whispering/vad/silero_vad_v5.onnx`,
				{ headers: authenticatedHeaders(server) },
			);
			expect(await vadAsset.text()).toBe('vad-model');
			const clientRoute = await fetch(
				`${server.url.origin}/apps/whispering/settings/transcription?tab=models`,
				{ headers: authenticatedHeaders(server) },
			);
			expect(withoutAuthBootstrap(await clientRoute.text())).toBe(
				WHISPERING_PAGE,
			);

			for (const response of [
				query,
				whispering,
				whisperingAsset,
				vadAsset,
				clientRoute,
			]) {
				expect(response.status).toBe(200);
				expect(response.headers.get('cache-control')).toBe('no-store');
				expect(response.headers.get('content-security-policy')).toContain(
					"default-src 'self'",
				);
			}
		} finally {
			await server.stop(true);
		}
	});

	test('rejects alternate app request targets without exposing filesystem paths', async () => {
		const server = await serveHost();
		try {
			for (const path of [
				'/apps/unknown/',
				'/apps/home/extra',
				'/apps/home%2f',
				'/apps/home/%2e%2e/%2e%2e/package.json',
				'/apps/home/%252e%252e/%252e%252e/package.json',
				'/apps/whispering/missing.js',
			]) {
				const response = await fetch(`${server.url.origin}${path}`);
				expect(response.status).toBe(404);
				expect(await response.text()).not.toContain('"scripts"');
			}

			// Home strings are SPA state, not an alternate server-side app page.
			const queryState = await fetch(
				`${HOME_ROUTE.url(server.url.origin)}?conversation=recent`,
				{ headers: authenticatedHeaders(server) },
			);
			expect(queryState.status).toBe(200);
			expect(withoutAuthBootstrap(await queryState.text())).toBe(PAGE);
		} finally {
			await server.stop(true);
		}
	});

	test('rejects wrong Host and Origin and serves the browser security policy', async () => {
		const server = await serveHost();
		try {
			const wrongHost = await fetch(
				HOME_ROUTE.url(server.url.origin).replace('127.0.0.1', 'localhost'),
			);
			expect(wrongHost.status).toBe(421);
			const wrongOrigin = await fetch(HOME_ROUTE.url(server.url.origin), {
				headers: { origin: 'https://example.com' },
			});
			expect(wrongOrigin.status).toBe(403);

			const page = await fetch(HOME_ROUTE.url(server.url.origin));
			expect(page.headers.get('content-security-policy')).toContain(
				"connect-src 'self' ipc: http://ipc.localhost",
			);
			expect(page.headers.get('content-security-policy')).toContain(
				"script-src 'self'",
			);
			expect(page.headers.get('content-security-policy')).not.toContain(
				"script-src 'self' 'unsafe-inline'",
			);
			expect(page.headers.get('referrer-policy')).toBe('no-referrer');
			expect(page.headers.get('x-frame-options')).toBe('DENY');
		} finally {
			await server.stop(true);
		}
	});

	test('admits first-party WebAssembly without restoring eval', async () => {
		const server = await serveHost();
		try {
			const page = await fetch(HOME_ROUTE.url(server.url.origin), {
				headers: authenticatedHeaders(server),
			});
			const directives = cspDirectives(
				page.headers.get('content-security-policy'),
			);
			const scriptSrc = directives.get('script-src') ?? [];

			// Voice activity detection compiles onnxruntime in this WebView.
			expect(scriptSrc).toContain("'wasm-unsafe-eval'");
			// The narrow token and only the narrow token: `eval` and `new Function`
			// stay refused, and inline scripts stay hash-pinned.
			expect(scriptSrc).not.toContain("'unsafe-eval'");
			expect(scriptSrc).not.toContain("'unsafe-inline'");
			expect(
				scriptSrc.some((token) => token.startsWith("'sha256-")),
			).toBeTrue();

			// Admitting WebAssembly must not have loosened anything else.
			expect(directives.get('worker-src')).toEqual(["'self'", 'blob:']);
			expect(directives.get('connect-src')).toEqual([
				"'self'",
				'ipc:',
				'http://ipc.localhost',
			]);
			expect(directives.get('object-src')).toEqual(["'none'"]);
			expect(directives.get('default-src')).toEqual(["'self'"]);

			// The capability is real on this origin, not a token for its own sake:
			// the binary the policy admits is served by this host.
			const wasm = await fetch(
				`${server.url.origin}/apps/whispering/vad/ort-wasm-simd-threaded.wasm`,
				{ headers: authenticatedHeaders(server) },
			);
			expect(wasm.status).toBe(200);
			expect(new Uint8Array(await wasm.arrayBuffer()).slice(0, 4)).toEqual(
				new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
			);
		} finally {
			await server.stop(true);
		}
	});

	test('the account broker requires the browser session and grants no bearer', async () => {
		const server = await serveHost();
		const { cookie, origin } = authenticationFor(server);
		try {
			const unauthorized = await fetch(ACCOUNT_SIGN_OUT_ROUTE.url(origin), {
				method: 'POST',
				headers: { origin },
			});
			expect(unauthorized.status).toBe(401);

			const missingOrigin = await fetch(ACCOUNT_SIGN_OUT_ROUTE.url(origin), {
				method: 'POST',
				headers: { cookie },
			});
			expect(missingOrigin.status).toBe(403);

			const profileWithoutSession = await fetch(
				ACCOUNT_PROFILE_ROUTE.url(origin),
			);
			expect(profileWithoutSession.status).toBe(401);

			const signedOut = await fetch(ACCOUNT_SIGN_OUT_ROUTE.url(origin), {
				method: 'POST',
				headers: { cookie, origin },
			});
			expect(signedOut.status).toBe(202);

			const invalidInstance = await fetch(ACCOUNT_INSTANCE_ROUTE.url(origin), {
				method: 'POST',
				headers: { cookie, origin, 'content-type': 'application/json' },
				body: JSON.stringify({
					baseURL: 'https://box.example',
					token: 'too-short',
				}),
			});
			expect(invalidInstance.status).toBe(400);

			const hosted = await fetch(ACCOUNT_INSTANCE_ROUTE.url(origin), {
				method: 'DELETE',
				headers: { cookie, origin },
			});
			expect(hosted.status).toBe(202);
		} finally {
			await server.stop(true);
		}
	});
});

describe('local blob routes', () => {
	test('session authentication protects every local blob operation', async () => {
		const server = await serveHost();
		const id = generateBlobId();
		try {
			for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
				const response = await fetch(
					`${server.url.origin}${desktopBlobUrl(id)}`,
					{ method },
				);
				expect(response.status).toBe(401);
			}
		} finally {
			await server.stop(true);
		}
	});

	test('remote copy routes take only the blob id and map typed results', async () => {
		const calls: { operation: string; id: string }[] = [];
		const stubRemote: BlobRemote = {
			async upload(id) {
				calls.push({ operation: 'upload', id });
				return Ok(undefined);
			},
			async download(id) {
				calls.push({ operation: 'download', id });
				return BlobRemoteError.RemoteBlobNotFound({ id });
			},
			async purge(id) {
				calls.push({ operation: 'purge', id });
				return BlobRemoteError.BlobRemoteFailed({
					id,
					cause: new Error('remote unreachable'),
				});
			},
		};
		const server = await serveHost(PAGE, stubRemote);
		const id = generateBlobId();
		const { cookie, origin } = authenticationFor(server);
		const session = { headers: { cookie, origin } };
		try {
			const unauthenticated = await fetch(
				`${server.url.origin}${desktopBlobUrl(id)}/upload`,
				{ method: 'POST' },
			);
			expect(unauthenticated.status).toBe(401);
			expect(calls).toHaveLength(0);

			const invalidId = await fetch(
				`${server.url.origin}/api/local-blobs/not-a-blob-id/upload`,
				{ method: 'POST', ...session },
			);
			expect(invalidId.status).toBe(400);

			// A caller-supplied body is dead weight, never a transfer target: the
			// stub still receives only the path id.
			const uploaded = await fetch(
				`${server.url.origin}${desktopBlobUrl(id)}/upload`,
				{
					method: 'POST',
					headers: { ...session.headers, 'content-type': 'application/json' },
					body: JSON.stringify({ uploadUrl: 'https://evil.example/steal' }),
				},
			);
			expect(uploaded.status).toBe(204);

			const downloaded = await fetch(
				`${server.url.origin}${desktopBlobUrl(id)}/download`,
				{ method: 'POST', ...session },
			);
			expect(downloaded.status).toBe(404);

			const purged = await fetch(
				`${server.url.origin}${desktopBlobUrl(id)}/purge`,
				{ method: 'POST', ...session },
			);
			expect(purged.status).toBe(502);

			expect(calls).toEqual([
				{ operation: 'upload', id },
				{ operation: 'download', id },
				{ operation: 'purge', id },
			]);
		} finally {
			await server.stop(true);
		}
	});

	test('a signed-out generation answers 503 for every remote copy operation', async () => {
		const server = await serveHost();
		const id = generateBlobId();
		const { cookie, origin } = authenticationFor(server);
		try {
			for (const operation of ['upload', 'download', 'purge']) {
				const response = await fetch(
					`${server.url.origin}${desktopBlobUrl(id)}/${operation}`,
					{ method: 'POST', headers: { cookie, origin } },
				);
				expect(response.status).toBe(503);
			}
		} finally {
			await server.stop(true);
		}
	});

	test('put, head, byte-range forms, collision, and idempotent delete share one id', async () => {
		const server = await serveHost();
		const id = generateBlobId();
		const url = `${server.url.origin}${desktopBlobUrl(id)}`;
		const { cookie, origin } = authenticationFor(server);
		try {
			const put = await fetch(url, {
				method: 'PUT',
				headers: {
					cookie,
					'content-type': 'audio/test',
					origin,
				},
				body: '0123456789',
			});
			expect(put.status).toBe(201);

			const head = await fetch(url, {
				method: 'HEAD',
				headers: { cookie },
			});
			expect(head.status).toBe(200);
			expect(head.headers.get('content-length')).toBe('10');
			expect(head.headers.get('content-type')).toBe('audio/test');
			expect(await head.text()).toBe('');

			const range = await fetch(url, {
				headers: { cookie, range: 'bytes=2-5' },
			});
			expect(range.status).toBe(206);
			expect(range.headers.get('content-range')).toBe('bytes 2-5/10');
			expect(await range.text()).toBe('2345');
			const suffix = await fetch(url, {
				headers: { cookie, range: 'bytes=-3' },
			});
			expect(suffix.status).toBe(206);
			expect(suffix.headers.get('content-range')).toBe('bytes 7-9/10');
			expect(await suffix.text()).toBe('789');
			const oversizedSuffix = await fetch(url, {
				headers: { cookie, range: 'bytes=-99' },
			});
			expect(oversizedSuffix.status).toBe(206);
			expect(oversizedSuffix.headers.get('content-range')).toBe('bytes 0-9/10');
			expect(await oversizedSuffix.text()).toBe('0123456789');
			const openEnded = await fetch(url, {
				headers: { cookie, range: 'bytes=6-' },
			});
			expect(openEnded.status).toBe(206);
			expect(openEnded.headers.get('content-range')).toBe('bytes 6-9/10');
			expect(await openEnded.text()).toBe('6789');
			const clamped = await fetch(url, {
				headers: { cookie, range: 'bytes=7-99' },
			});
			expect(clamped.status).toBe(206);
			expect(clamped.headers.get('content-range')).toBe('bytes 7-9/10');
			expect(await clamped.text()).toBe('789');
			const unsatisfiable = await fetch(url, {
				headers: { cookie, range: 'bytes=99-' },
			});
			expect(unsatisfiable.status).toBe(416);
			expect(unsatisfiable.headers.get('content-range')).toBe('bytes */10');
			for (const refusedRange of [
				'bytes=',
				'bytes=-',
				'bytes=5-2',
				'bytes=0-1,3-4',
				'bytes = 0-1',
				'items=0-1',
			]) {
				const refused = await fetch(url, {
					headers: { cookie, range: refusedRange },
				});
				expect(refused.status).toBe(416);
				expect(refused.headers.get('content-range')).toBe('bytes */10');
			}

			const emptyId = generateBlobId();
			const emptyUrl = `${server.url.origin}${desktopBlobUrl(emptyId)}`;
			expect(
				(
					await fetch(emptyUrl, {
						method: 'PUT',
						headers: { cookie, origin },
						body: '',
					})
				).status,
			).toBe(201);
			const emptyRange = await fetch(emptyUrl, {
				headers: { cookie, range: 'bytes=0-' },
			});
			expect(emptyRange.status).toBe(416);
			expect(emptyRange.headers.get('content-range')).toBe('bytes */0');

			const collision = await fetch(url, {
				method: 'PUT',
				headers: { cookie, 'content-type': 'audio/test', origin },
				body: 'replacement',
			});
			expect(collision.status).toBe(409);

			for (const expectedGetStatus of [404, 404]) {
				const deleted = await fetch(url, {
					method: 'DELETE',
					headers: { cookie, origin },
				});
				expect(deleted.status).toBe(204);
				const missing = await fetch(url, { headers: { cookie } });
				expect(missing.status).toBe(expectedGetStatus);
			}
		} finally {
			await server.stop(true);
		}
	});

	test('hostile blob content is downloadable but cannot become same-origin code', async () => {
		const server = await serveHost();
		const id = generateBlobId();
		const url = `${server.url.origin}${desktopBlobUrl(id)}`;
		const { cookie, origin } = authenticationFor(server);
		try {
			expect(
				(
					await fetch(url, {
						method: 'PUT',
						headers: { cookie, 'content-type': 'text/html', origin },
						body: '<script>globalThis.compromised = true</script>',
					})
				).status,
			).toBe(201);

			const response = await fetch(url, { headers: { cookie } });
			expect(response.headers.get('content-disposition')).toBe('attachment');
			expect(response.headers.get('content-security-policy')).toBe(
				"sandbox; default-src 'none'",
			);
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(response.headers.get('cross-origin-resource-policy')).toBe(
				'same-origin',
			);
			expect(await response.text()).toContain('<script>');
		} finally {
			await server.stop(true);
		}
	});

	test('path-hostile and foreign ids are rejected before filesystem access', async () => {
		const server = await serveHost();
		try {
			const response = await fetch(
				`${server.url.origin}/api/local-blobs/not-a-blob-id`,
				{ headers: authenticatedHeaders(server) },
			);
			expect(response.status).toBe(400);
		} finally {
			await server.stop(true);
		}
	});
});

// ============================================================================
// Built SPA Tests (the real vite build)
// ============================================================================

let builtPagePromise: Promise<string> | undefined;

/**
 * Run the real Vite build once per test run and return Home's index document.
 * Memoized because both the built-SPA describe and the sidecar smoke need it,
 * and bun test does not guarantee an ordering contract between describes.
 */
function buildSpaOnce(): Promise<string> {
	builtPagePromise ??= (async () => {
		const outDir = mkdtempSync(join(tmpdir(), 'epicenter-home-build-'));
		const build = Bun.spawn(['bun', 'x', 'vite', 'build', '--outDir', outDir], {
			cwd: queryDir,
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const exitCode = await build.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(build.stderr).text();
			throw new Error(`vite build exited with ${exitCode}:\n${stderr}`);
		}
		return Bun.file(join(outDir, 'index.html')).text();
	})();
	return builtPagePromise;
}

describe('the built SPA', () => {
	test('the build emits one self-contained document and the server returns it byte-for-byte', async () => {
		const page = await buildSpaOnce();

		// Home currently ships as one document. The server hashes every inline
		// script into its CSP instead of allowing arbitrary inline execution.
		const scriptTags = page.match(/<script\b[^>]*>/gi) ?? [];
		expect(scriptTags.length).toBeGreaterThan(0);
		for (const tag of scriptTags) {
			expect(tag).not.toMatch(/\ssrc\s*=/i);
		}
		// No asset-bearing tag may reference an external file. Matching tag
		// attributes (not raw substrings) keeps legitimate inline JS or CSS
		// content from false-positives.
		for (const [tag] of page.matchAll(
			/<(?:img|iframe|source|audio|video|embed)\b[^>]*>/gi,
		)) {
			expect(tag).not.toMatch(/\ssrc\s*=/i);
		}
		expect(page).not.toMatch(/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i);
		expect(page).not.toMatch(/<link\b[^>]*\bhref\s*=/i);

		const server = await serveHost(page);
		try {
			const response = await fetch(HOME_ROUTE.url(server.url.origin), {
				headers: authenticatedHeaders(server),
			});
			expect(response.status).toBe(200);
			expect(withoutAuthBootstrap(await response.text())).toBe(page);
			const scriptSrc =
				cspDirectives(response.headers.get('content-security-policy')).get(
					'script-src',
				) ?? [];
			expect(
				scriptSrc.some((token) => token.startsWith("'sha256-")),
			).toBeTrue();
			expect(scriptSrc).not.toContain("'unsafe-inline'");
		} finally {
			await server.stop(true);
		}
	}, 60_000);
});

// ============================================================================
// Sidecar End-to-End Smoke (the real main.ts entrypoint)
// ============================================================================

/**
 * Read the sidecar's stdout until the one-line versioned ready announcement.
 * Rejects with the buffered stdout (or the sidecar's stderr, if it exited)
 * so a failed launch names its cause instead of timing out silently.
 */
async function readPortAnnouncement(
	sidecar: {
		stdout: ReadableStream<Uint8Array>;
		stderr: ReadableStream<Uint8Array>;
	},
	timeoutMs: number,
): Promise<number> {
	const reader = sidecar.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(
				new Error(
					`no port announcement within ${timeoutMs}ms; stdout so far: ${JSON.stringify(buffer)}`,
				),
			);
		}, timeoutMs);
	});
	try {
		while (true) {
			const { value, done } = await Promise.race([reader.read(), timeout]);
			if (value) {
				buffer += decoder.decode(value, { stream: true });
				const newline = buffer.indexOf('\n');
				if (newline !== -1) {
					const line = buffer.slice(0, newline);
					const ready = JSON.parse(line) as ReadyFrame;
					expect(ready).toEqual({
						type: 'ready',
						protocolVersion: 2,
						port: ready.port,
					});
					return ready.port;
				}
			}
			if (done) {
				const stderr = await new Response(sidecar.stderr).text();
				throw new Error(
					`the sidecar exited before announcing a port:\n${stderr}`,
				);
			}
		}
	} finally {
		clearTimeout(timer);
		reader.releaseLock();
	}
}

async function exitWithin(
	sidecar: { exited: Promise<number> },
	timeoutMs: number,
): Promise<number> {
	return Promise.race([
		sidecar.exited,
		Bun.sleep(timeoutMs).then(() => {
			throw new Error(`sidecar did not exit within ${timeoutMs}ms`);
		}),
	]);
}

describe('sidecar end-to-end smoke', () => {
	test('the spawned entrypoint announces readiness and serves the built SPA', async () => {
		const page = await buildSpaOnce();
		const appsDist = writeAppsDistFixture(page);

		const portProbe = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: () => new Response(),
		});
		const port = boundPort(portProbe);
		await portProbe.stop(true);
		const sidecar = Bun.spawn(
			['bun', 'run', 'src/main.ts', '--runtime-mode=development'],
			{
				cwd: queryDir,
				env: {
					...process.env,
					EPICENTER_APPS_DIST: appsDist,
					// Keep the host's replicas out of the real user data directory.
					EPICENTER_DATA_DIR: testDataDir(),
				},
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		);
		try {
			// The credential and Rust-resolved port travel in the boot frame.
			sidecar.stdin.write(
				`${JSON.stringify({ type: 'boot', protocolVersion: 2, token: TOKEN, port, authCell: null })}\n`,
			);
			await sidecar.stdin.flush();
			const announcedPort = await readPortAnnouncement(sidecar, 30_000);
			expect(announcedPort).toBe(port);
			const origin = `http://127.0.0.1:${announcedPort}`;

			const shell = await fetch(HOME_ROUTE.url(origin));
			expect(shell.status).toBe(200);
			expect(await shell.text()).toContain('__EPICENTER_SESSION_READY__');

			const bootstrap = await fetch(BOOTSTRAP_ROUTE.url(origin), {
				method: 'POST',
				headers: {
					authorization: `Bearer ${TOKEN}`,
					origin,
				},
			});
			expect(bootstrap.status).toBe(204);
			const cookie = bootstrap.headers.get('set-cookie')?.split(';', 1)[0];
			expect(cookie).toBeDefined();
			const served = await fetch(HOME_ROUTE.url(origin), {
				headers: { cookie: cookie ?? '' },
			});
			expect(withoutAuthBootstrap(await served.text())).toBe(page);
		} finally {
			sidecar.kill('SIGTERM');
			expect(await sidecar.exited).toBe(0);
		}
	}, 60_000);

	test('a port collision exits without announcing readiness or falling back', async () => {
		const appsDist = writeAppsDistFixture(await buildSpaOnce());
		const occupied = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: () => new Response('occupied'),
		});
		const occupiedPort = boundPort(occupied);
		const sidecar = Bun.spawn(
			['bun', 'run', 'src/main.ts', '--runtime-mode=development'],
			{
				cwd: queryDir,
				env: {
					...process.env,
					EPICENTER_APPS_DIST: appsDist,
					EPICENTER_DATA_DIR: testDataDir(),
				},
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		);
		try {
			sidecar.stdin.write(
				`${JSON.stringify({ type: 'boot', protocolVersion: 2, token: TOKEN, port: occupiedPort, authCell: null })}\n`,
			);
			await sidecar.stdin.flush();
			expect(await exitWithin(sidecar, 30_000)).not.toBe(0);
			expect(await new Response(sidecar.stdout).text()).toBe('');
			expect(await new Response(sidecar.stderr).text()).toMatch(
				/port|address/i,
			);
		} finally {
			sidecar.kill();
			await occupied.stop(true);
		}
	}, 60_000);

	test('parent-pipe EOF exits and releases the listening port', async () => {
		const appsDist = writeAppsDistFixture(await buildSpaOnce());
		const portProbe = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: () => new Response(),
		});
		const port = boundPort(portProbe);
		await portProbe.stop(true);
		const sidecar = Bun.spawn(
			['bun', 'run', 'src/main.ts', '--runtime-mode=development'],
			{
				cwd: queryDir,
				env: {
					...process.env,
					EPICENTER_APPS_DIST: appsDist,
					EPICENTER_DATA_DIR: testDataDir(),
				},
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		);
		try {
			sidecar.stdin.write(
				`${JSON.stringify({ type: 'boot', protocolVersion: 2, token: TOKEN, port, authCell: null })}\n`,
			);
			await sidecar.stdin.flush();
			expect(await readPortAnnouncement(sidecar, 30_000)).toBe(port);
			sidecar.stdin.end();
			expect(await exitWithin(sidecar, 30_000)).toBe(0);

			const replacement = Bun.serve({
				hostname: '127.0.0.1',
				port,
				fetch: () => new Response(),
			});
			expect(replacement.port).toBe(port);
			await replacement.stop(true);
		} finally {
			sidecar.kill();
		}
	}, 60_000);
});
