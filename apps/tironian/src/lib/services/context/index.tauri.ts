import { commands } from '$lib/tauri/commands';
import type { ContextService } from './types';

export type {
	ContextService,
	FieldReadOutcome,
	FocusedFieldKind,
	ForegroundContext,
} from './types';

export const ContextServiceLive = {
	getForegroundContext: () => commands.getForegroundContext(),
	readFocusedText: () => commands.readFocusedText(),
	endFieldObservation: async () => {
		await commands.endFieldObservation();
	},
} satisfies ContextService;
