import { commands } from '$lib/tauri/commands';
import type { ContextService } from './types';

export type {
	ContextService,
	FocusedFieldKind,
	ForegroundContext,
} from './types';

export const ContextServiceLive = {
	getForegroundContext: () => commands.getForegroundContext(),
} satisfies ContextService;
