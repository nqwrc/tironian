/** Home's entry point: mount the model administration shell. */

import '@tironian/ui/app.css';
import { mount } from 'svelte';
import App from './App.svelte';

mount(App, {
	// biome-ignore lint/style/noNonNullAssertion: index.html always ships the mount node.
	target: document.getElementById('app')!,
});
