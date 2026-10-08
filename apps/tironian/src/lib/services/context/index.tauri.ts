import { commands } from '$lib/tauri/commands';
import type { ContextService } from './types';

export type {
	ContextService,
	CursorContextOutcome,
	FieldReadOutcome,
	FocusedFieldKind,
	ForegroundContext,
} from './types';

export const ContextServiceLive = {
	getForegroundContext: () => commands.getForegroundContext(),
	readFocusedText: () => commands.readFocusedText(),
	endFieldObservation: async (generation) => {
		await commands.endFieldObservation(generation);
	},
	readContextAtCapture: () => commands.readContextAtCapture(),
} satisfies ContextService;
