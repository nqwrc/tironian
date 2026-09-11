import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { APPS } from '@tironian/constants/apps';
// VAD fetches these files from `/vad/*` at runtime (they are not bundled). The
// recorder package owns the VAD capability and resolves the asset source paths
// from its own pinned dependency tree; we just copy them into the served `/vad/`
// directory at build time (see @tironian/recorder/vad-assets).
import { VAD_ASSET_DEST, vadAssetSources } from '@tironian/recorder/vad-assets';
import { workspaceAppViteConfig } from '@tironian/vite-config';
import { defaultClientConditions, defineConfig, mergeConfig } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const isTironianHost = process.env.TIRONIAN_HOST === '1';

export default defineConfig(
	mergeConfig(workspaceAppViteConfig(APPS.TIRONIAN), {
		plugins: [
			// Compile-time i18n. Messages become tree-shaken ESM functions, so a
			// locale nobody selected costs nothing in the bundle.
			//
			// No `url` strategy on purpose: this app has no locale in its routes and
			// must not grow one. The two base paths it already ships (`/` in the
			// browser build, `/apps/dictation` under the desktop host) are enough
			// surface without a locale segment on top.
			//
			// `localStorage` before `baseLocale` because the locale must resolve
			// synchronously on the first paint. The store holds the authority for the
			// setting and syncs it between devices; localStorage is the local cache
			// that is readable before the store opens. `app.html` already does exactly
			// this for the theme, for the same reason.
			paraglideVitePlugin({
				project: './project.inlang',
				outdir: './src/lib/paraglide',
				strategy: ['localStorage', 'baseLocale'],
				emitTsDeclarations: true,
			}),
			devtoolsJson(),
			viteStaticCopy({
				// `stripBase` drops the source's directory segments so each file
				// lands directly at /vad/<name> (the plugin otherwise mirrors the
				// full absolute source path under dest).
				targets: vadAssetSources.map((src) => ({
					src,
					dest: VAD_ASSET_DEST,
					rename: { stripBase: true },
				})),
			}),
		],
		// onnxruntime-web (pulled in by @ricky0123/vad-web) ships a WASM glue
		// .mjs that Vite's dep optimizer can't pre-bundle (it 404s on
		// .vite/deps/ort-wasm-simd-threaded.mjs). Keep that package and its wasm
		// subpath native, but still prebundle vad-web so Vite converts its
		// CommonJS entry to ESM for browser dev mode.
		optimizeDeps: {
			// @sqlite.org/sqlite-wasm resolves its .wasm relative to its own
			// module URL inside the records Worker; pre-bundling breaks that.
			exclude: [
				'onnxruntime-web',
				'onnxruntime-web/wasm',
				'@sqlite.org/sqlite-wasm',
			],
		},
		// The records Worker (module type) transitively includes sqlite-wasm;
		// its chunk needs ES output and current syntax.
		worker: { format: 'es' },
		build: { target: 'esnext' },
		resolve: {
			// Build-time platform DI over the `#platform/*` subpaths (package.json
			// "imports"). This build activates both conditions because both are
			// true of it, and they answer different questions: `tironian-host`
			// selects the leaves whose owner is the Bun host (its replica,
			// credential, deployment choice, blob bytes, and asset base), `tauri`
			// the leaves that call native commands. Tironian has no build where
			// they come apart, so the seam could collapse to one leaf, but the
			// shared vite-config names the two conditions apart on purpose rather
			// than collapsing them per app. The web build uses `default`
			// (browser) for every seam, so a desktop-only file imported by shared
			// code is unresolvable there and fails at vite build time rather than
			// at user runtime. The `...defaultClientConditions` spread is
			// load-bearing: custom conditions REPLACE Vite's defaults.
			...(isTironianHost && {
				conditions: ['tironian-host', 'tauri', ...defaultClientConditions],
			}),
		},
	}),
);
