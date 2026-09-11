import { QueryClient } from '@tanstack/svelte-query';
import { createQueryFactories } from 'wellcrafted/query';
import { browser } from '$app/environment';

/** Create the TanStack query owner for one mounted Tironian UI session. */
export function createTironianQueryRuntime() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				enabled: browser,
			},
		},
	});

	return {
		queryClient,
		...createQueryFactories(queryClient),
	};
}

export type TironianQueryRuntime = ReturnType<
	typeof createTironianQueryRuntime
>;
