import type { DataOf } from '@epicenter/data';
import { type DeviceStore, openDevice } from '@epicenter/data/browser';
import {
	type WhisperingSettingValues,
	whisperingDefinition,
} from '../workspace';
import {
	createWhisperingAppRules,
	type WhisperingAppRules,
} from './app-rules.svelte';
import {
	createWhisperingRecipes,
	type WhisperingRecipes,
} from './recipes.svelte';
import type { WhisperingBlobs } from './recording-audio';
import {
	createWhisperingRecordings,
	type WhisperingRecordings,
} from './recordings';
import {
	createWhisperingSnippets,
	type WhisperingSnippets,
} from './snippets.svelte';

export type { WhisperingBlobs } from './recording-audio';

/** The one document: this machine's settings and its work. */
export type WhisperingDeviceData = DataOf<
	typeof whisperingDefinition,
	DeviceStore
>;

/** Environment-owned inputs for one fully acquired Whispering app. */
export type WhisperingAppDependencies = {
	blobs: WhisperingBlobs;
};

/**
 * Hydrated, UI-free settings over typed singleton values.
 *
 * The device document's `kv`. Which microphone shortcut this machine listens
 * for, which transcription service it can reach, and whether it plays a
 * sound are facts about this machine.
 */
export type WhisperingSettings = {
	get<TKey extends keyof WhisperingSettingValues>(
		key: TKey,
	): WhisperingSettingValues[TKey];
	set<TKey extends keyof WhisperingSettingValues>(
		key: TKey,
		value: WhisperingSettingValues[TKey],
	): void;
	getDefault<TKey extends keyof WhisperingSettingValues>(
		key: TKey,
	): WhisperingSettingValues[TKey];
	reset(): void;
	subscribe(listener: () => void): () => void;
};

/** Release-local initialization and recovery values for the device KV. */
const APPLICATION_DEFAULTS: Partial<WhisperingSettingValues> = {
	soundManualStart: true,
	soundManualStop: true,
	soundManualCancel: true,
	soundVadStart: true,
	soundVadCapture: true,
	soundVadStop: true,
	soundTranscriptionComplete: true,
	soundRecipeComplete: true,
	outputTranscriptionClipboard: true,
	outputTranscriptionCursor: true,
	outputTranscriptionEnter: false,
	outputRecipeClipboard: true,
	outputRecipeCursor: false,
	outputRecipeEnter: false,
	recordingTrigger: 'manual',
	recordingPausePlayback: false,
	recordingOverlayXAnchor: 'center',
	recordingOverlayXMarginPx: 0,
	recordingOverlayYAnchor: 'bottom',
	recordingOverlayYMarginPx: 72,
	transcriptionService: 'local',
	transcriptionOpenaiModel: 'whisper-1',
	transcriptionGroqModel: 'whisper-large-v3-turbo',
	transcriptionElevenlabsModel: 'scribe_v2',
	transcriptionDeepgramModel: 'nova-3',
	transcriptionMistralModel: 'voxtral-mini-latest',
	// English is the source language: it is what the messages are authored in and
	// what an untranslated string falls back to. A locale is a choice, never a
	// guess from the host, which is why this does not read the browser's
	// preferred language.
	interfaceLocale: 'en',
	transcriptionLanguage: 'auto',
	transcriptionPrompt: '',
	completionProvider: 'Google',
	completionModel: 'gemini-2.5-flash',
	dictionary: null,
	polishEnabled: true,
	polishInstructions: 'Fix grammar and punctuation. Keep my wording.',
	commandModeEnabled: true,
	secureFieldGuardEnabled: true,
	secureFieldCaptureGateEnabled: false,
	// Off until someone asks for it. There is no first-run screen, so shipping
	// this on means the first event fires before any consent moment exists, and
	// a local-first app that phones home by default has given away the one claim
	// it is built on. The Analytics card on the account page is the opt-in.
	analyticsEnabled: false,
	shortcutPushToTalkModifiers: null,
	shortcutPushToTalkKeys: null,
	shortcutToggleManualRecordingModifiers: null,
	shortcutToggleManualRecordingKeys: null,
	shortcutCancelRecordingModifiers: null,
	shortcutCancelRecordingKeys: null,
	shortcutToggleVadRecordingModifiers: null,
	shortcutToggleVadRecordingKeys: null,
	shortcutOpenRecipePickerModifiers: null,
	shortcutOpenRecipePickerKeys: null,
	shortcutRunRecipeOnClipboardModifiers: null,
	shortcutRunRecipeOnClipboardKeys: null,
	shortcutOpenSettingsModifiers: null,
	shortcutOpenSettingsKeys: null,
};

export type WhisperingApp = {
	readonly settings: WhisperingSettings;
	readonly recordings: WhisperingRecordings;
	readonly recipes: WhisperingRecipes;
	readonly snippets: WhisperingSnippets;
	readonly appRules: WhisperingAppRules;
	[Symbol.asyncDispose](): Promise<void>;
};

/**
 * Acquire one ready Whispering app over its one document.
 *
 * The device document opens for every page lifetime and holds this machine's
 * settings and its work (recordings, recipes, snippets, app rules). There is
 * no other document to choose between: local-first, one machine, one owner.
 */
export async function openWhisperingApp(
	{ blobs }: WhisperingAppDependencies,
	{ signal }: { signal?: AbortSignal } = {},
): Promise<WhisperingApp> {
	signal?.throwIfAborted();

	const opened = await openDevice(whisperingDefinition);
	if (opened.error !== null) throw opened.error;
	const deviceData = opened.data;

	const settingsDomain = createWhisperingSettings({ kv: deviceData.kv });
	const recordingsDomain = createWhisperingRecordings({
		table: deviceData.tables.recordings,
		blobs,
	});
	const recipesDomain = createWhisperingRecipes({
		table: deviceData.tables.recipes,
	});
	const snippetsDomain = createWhisperingSnippets({
		table: deviceData.tables.snippets,
	});
	const appRulesDomain = createWhisperingAppRules({
		table: deviceData.tables.appRules,
	});

	let disposed = false;
	return Object.freeze({
		settings: settingsDomain.settings,
		recordings: recordingsDomain.recordings,
		recipes: recipesDomain,
		snippets: snippetsDomain,
		appRules: appRulesDomain,
		async [Symbol.asyncDispose]() {
			if (disposed) return;
			disposed = true;
			appRulesDomain[Symbol.dispose]();
			snippetsDomain[Symbol.dispose]();
			recipesDomain[Symbol.dispose]();
			recordingsDomain[Symbol.dispose]();
			settingsDomain[Symbol.dispose]();
			await deviceData[Symbol.asyncDispose]();
		},
	});
}

type SettingKey = keyof WhisperingSettingValues;

/**
 * Settings over the workspace's KV, which is one name-addressed root.
 *
 * What this replaces was substantial and every piece of it answered a problem
 * that no longer exists. Settings were one ROW at a chosen id, so there was a
 * row id constant, a `settingFieldName` mapping from setting to column, and a
 * read that had to create the row when it was missing. Reads were asynchronous,
 * so there were per-key read generations, a `bumpGeneration` on every read and
 * write, an `isReleased` guard, and a background write queue that reconciled
 * `loadError` after the fact. Values came back live, so every read and write
 * ran `structuredClone`.
 *
 * KV is a reserved root, reads are synchronous, and a read hands back a plain
 * object or a conformance diagnostic (ADR-0213, ADR-0215, ADR-0216). So a read
 * is a read, a write names its keys, and application recovery handles missing
 * values without creating a row to hold them.
 */
function createWhisperingSettings({ kv }: { kv: WhisperingDeviceData['kv'] }) {
	let values = { ...APPLICATION_DEFAULTS } as WhisperingSettingValues;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) listener();
	};

	function read(): void {
		const { data, error } = kv.get();
		if (error !== null) {
			// A stored value the current release cannot read costs those keys, not
			// the whole object: the error arm is always the diagnostic, and its
			// `conforming` carries the ones that did pass.
			values = {
				...APPLICATION_DEFAULTS,
				...error.conforming,
			} as WhisperingSettingValues;
			notify();
			return;
		}
		values = data;
		notify();
	}

	read();
	const stop = kv.subscribe(read);

	const write = (patch: Partial<WhisperingSettingValues>): void => {
		kv.update(patch);
		// The subscription above already re-read inside the write; nothing left
		// to refresh here.
	};

	const settings: WhisperingSettings = {
		get<TKey extends SettingKey>(key: TKey) {
			return values[key];
		},
		set<TKey extends SettingKey>(
			key: TKey,
			value: WhisperingSettingValues[TKey],
		) {
			write({ [key]: value } as Partial<WhisperingSettingValues>);
		},
		getDefault<TKey extends SettingKey>(key: TKey) {
			return APPLICATION_DEFAULTS[key] as WhisperingSettingValues[TKey];
		},
		reset() {
			write(APPLICATION_DEFAULTS);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};

	return {
		settings,
		[Symbol.dispose]() {
			stop();
			listeners.clear();
		},
	};
}
