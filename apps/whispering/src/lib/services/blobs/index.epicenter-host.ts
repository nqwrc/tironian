import type { BlobSources, BlobStore } from '@epicenter/blobs';
import {
	createWebviewBlobSources,
	createWebviewBlobStore,
} from '@epicenter/blobs/webview';

const local = createWebviewBlobStore();

/**
 * Desktop composition: the host's canonical filesystem bytes behind the
 * authenticated WebView adapter. Local-only: there is no remote copy
 * capability.
 */
export const BlobsLive: {
	local: BlobStore;
} = {
	local,
};

export const BlobSourcesLive: BlobSources = createWebviewBlobSources(local);
