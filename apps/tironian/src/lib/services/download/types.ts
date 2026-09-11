import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';
import { m } from '../../paraglide/messages';

export const DownloadError = defineErrors({
	SaveDialogFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to open save dialog: ${extractErrorMessage(cause)}`,
		cause,
	}),
	SaveCancelled: () => ({
		message: m.types_please_specify_a_path_to_save_the_recording(),
	}),
	WriteFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to write file: ${extractErrorMessage(cause)}`,
		cause,
	}),
	BrowserDownloadFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to download in browser: ${extractErrorMessage(cause)}`,
		cause,
	}),
});
export type DownloadError = InferErrors<typeof DownloadError>;

export type DownloadService = {
	downloadBlob: (args: {
		name: string;
		blob: Blob;
	}) => Promise<Result<void, DownloadError>>;
};
