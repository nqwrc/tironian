/**
 * Bun-owned routes on the one trusted Epicenter origin.
 *
 * The built-in route table is deliberately closed and compiled. Rust can mirror
 * the IDs and paths without discovering or loading an application registry, and
 * it derives its own window labels from those IDs: a window label is Tauri's
 * handle, so Bun states no opinion about one. The bootstrap route is host
 * infrastructure: Tauri exchanges the per-launch credential there before any
 * SPA reaches domain code.
 */

import { LOCAL_BLOB_PATH } from '@epicenter/blobs/webview';

const stripTrailing = (value: string) => value.replace(/\/+$/, '');

function route(pattern: string) {
	return {
		pattern,
		url: (baseUrl: string) => `${stripTrailing(baseUrl)}${pattern}`,
	} as const;
}

function builtInRoute<const TId extends string>(id: TId, title: string) {
	return {
		id,
		title,
		...route(`/apps/${id}/`),
	};
}

export const BUILT_IN_ROUTES = {
	home: builtInRoute('home', 'Home'),
	whispering: builtInRoute('whispering', 'Tironian'),
} as const;

export type BuiltInRouteId = keyof typeof BUILT_IN_ROUTES;

export const BOOTSTRAP_ROUTE = route('/_epicenter/bootstrap');
export const HOME_ROUTE = BUILT_IN_ROUTES.home;
export const WHISPERING_ROUTE = BUILT_IN_ROUTES.whispering;
export const LOCAL_BLOB_ROUTE = {
	pattern: `${LOCAL_BLOB_PATH}/:blobId`,
} as const;
