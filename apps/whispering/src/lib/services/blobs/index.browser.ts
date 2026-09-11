import type { BlobSources, BlobStore } from '@epicenter/blobs';
import {
	createBrowserBlobSources,
	createBrowserBlobStore,
} from '@epicenter/blobs/browser';

const local = createBrowserBlobStore();

/** Browser composition: IndexedDB local bytes. Local-only, no remote copy. */
export const BlobsLive: {
	local: BlobStore;
} = {
	local,
};

export const BlobSourcesLive: BlobSources = createBrowserBlobSources(local);
