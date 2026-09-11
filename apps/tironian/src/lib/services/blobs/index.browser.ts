import type { BlobSources, BlobStore } from '@tironian/blobs';
import {
	createBrowserBlobSources,
	createBrowserBlobStore,
} from '@tironian/blobs/browser';

const local = createBrowserBlobStore();

/** Browser composition: IndexedDB local bytes. Local-only, no remote copy. */
export const BlobsLive: {
	local: BlobStore;
} = {
	local,
};

export const BlobSourcesLive: BlobSources = createBrowserBlobSources(local);
