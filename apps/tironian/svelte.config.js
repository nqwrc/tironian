// Tironian ships desktop only (the desktop host's build writes into its
// packaged asset tree and serves the SPA below its stable loopback route).
// The browser build still exists at `build/` for local typecheck and test,
// not for deployment: there is no hosted Cloudflare target any more.
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isTironianHost = process.env.TIRONIAN_HOST === '1';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: staticAdapter({
			...(isTironianHost && {
				pages: '../desktop/dist/dictation',
				assets: '../desktop/dist/dictation',
			}),
			fallback: 'index.html', // SPA fallback for dynamic routes
		}),
		...(isTironianHost && { paths: { base: '/apps/dictation' } }),
		alias: {
			$routes: './src/routes',
		},
		// No `csp` block here on purpose. The browser build is not deployed
		// (Tironian ships desktop only), so it needs no CSP header of its own.
		// The desktop host owns CSP for the loopback host it actually serves;
		// see its server policy.
	},

	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	vitePlugin: {
		inspector: {
			// This block owns dev-tooling behavior, not geometry. The toggle
			// inherits the plugin default 'top-right', the corner left free by
			// the current chrome (sidebar on the left, full-width BottomNav at
			// the bottom). The app must never reposition #svelte-inspector-host:
			// earlier CSS overrides keyed to nav z-index broke twice when the nav
			// changed. To move or disable it per-machine, set an env var instead
			// (the plugin gives it top precedence), e.g.
			// SVELTE_INSPECTOR_OPTIONS='{"toggleButtonPos":"top-left"}'
			holdMode: true,
			showToggleButton: 'always',
			toggleKeyCombo: 'alt-x',
		},
	},
};

export default config;
