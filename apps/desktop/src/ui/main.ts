/** Home's entry point: mount the model administration shell. */

import '@tironian/ui/app.css';
// The dictation window's brand layer, after the shared theme so it wins. One
// file for both windows, so their palettes cannot drift.
import '@tironian/app/brand.css';
import { mount } from 'svelte';
import App from './App.svelte';

mount(App, {
	// biome-ignore lint/style/noNonNullAssertion: index.html always ships the mount node.
	target: document.getElementById('app')!,
});
