/**
 * Named groups of `settingsKv` keys, for the settings import and export bundle.
 * Mirrors the existing Settings sub-pages so the checkbox list maps onto pages
 * the person already knows rather than an arbitrary split.
 *
 * The completeness test beside this file is the point of writing the map by
 * hand instead of deriving it from a naming convention: a prefix match (say,
 * every `output*` key) is itself a silent-drop hazard the moment a key does not
 * fit the pattern it assumes. A flat list fails loudly in a test instead.
 *
 * See `specs/20260830T130918-settings-import-export.md`.
 */
import type { TironianSettingValues } from '../workspace';

export const PREFERENCE_CATEGORIES = [
	'language',
	'sounds',
	'outputDelivery',
	'recording',
	'transcription',
	'processing',
	'dictationPolish',
	'commandMode',
	'dictionary',
	'shortcuts',
	'analytics',
] as const;
export type PreferenceCategory = (typeof PREFERENCE_CATEGORIES)[number];

export const PREFERENCE_CATEGORY_LABELS: Record<PreferenceCategory, string> = {
	language: 'Language',
	sounds: 'Sounds',
	outputDelivery: 'Output delivery',
	recording: 'Recording',
	transcription: 'Transcription',
	processing: 'Processing',
	dictationPolish: 'Dictation & Polish',
	commandMode: 'Command Mode',
	dictionary: 'Dictionary',
	shortcuts: 'Shortcuts',
	analytics: 'Analytics',
};

export const PREFERENCE_CATEGORY_KEYS: Record<
	PreferenceCategory,
	readonly (keyof TironianSettingValues)[]
> = {
	sounds: [
		'soundManualStart',
		'soundManualStop',
		'soundManualCancel',
		'soundVadStart',
		'soundVadCapture',
		'soundVadStop',
		'soundTranscriptionComplete',
		'soundRecipeComplete',
	],
	outputDelivery: [
		'outputTranscriptionClipboard',
		'outputTranscriptionCursor',
		'outputTranscriptionEnter',
		'outputRecipeClipboard',
		'outputRecipeCursor',
		'outputRecipeEnter',
	],
	recording: [
		'recordingTrigger',
		'recordingPausePlayback',
		'recordingOverlayXAnchor',
		'recordingOverlayXMarginPx',
		'recordingOverlayYAnchor',
		'recordingOverlayYMarginPx',
	],
	transcription: [
		'transcriptionService',
		'transcriptionOpenaiModel',
		'transcriptionGroqModel',
		'transcriptionElevenlabsModel',
		'transcriptionDeepgramModel',
		'transcriptionMistralModel',
		'transcriptionLanguage',
		'transcriptionPrompt',
	],
	/**
	 * The language the interface speaks, kept apart from `transcription` on
	 * purpose: that category is about what the speaker says, this is about what
	 * the app says back, and someone dictating Italian into an English interface
	 * is an ordinary setup rather than a misconfiguration.
	 */
	language: ['interfaceLocale'],
	processing: [
		'completionProvider',
		'completionModel',
		'secureFieldGuardEnabled',
		'secureFieldCaptureGateEnabled',
	],
	dictationPolish: ['polishEnabled', 'polishInstructions'],
	commandMode: ['commandModeEnabled'],
	dictionary: ['dictionary'],
	shortcuts: [
		'shortcutPushToTalkModifiers',
		'shortcutPushToTalkKeys',
		'shortcutToggleManualRecordingModifiers',
		'shortcutToggleManualRecordingKeys',
		'shortcutCancelRecordingModifiers',
		'shortcutCancelRecordingKeys',
		'shortcutToggleVadRecordingModifiers',
		'shortcutToggleVadRecordingKeys',
		'shortcutOpenRecipePickerModifiers',
		'shortcutOpenRecipePickerKeys',
		'shortcutRunRecipeOnClipboardModifiers',
		'shortcutRunRecipeOnClipboardKeys',
		'shortcutOpenSettingsModifiers',
		'shortcutOpenSettingsKeys',
	],
	analytics: ['analyticsEnabled'],
};

/**
 * The two table-backed categories. They are named apart from the preference
 * categories because they behave differently on import: a preference category
 * overwrites, a table category is appended to.
 */
export const TABLE_CATEGORIES = ['snippets', 'recipes', 'appRules'] as const;
export type TableCategory = (typeof TABLE_CATEGORIES)[number];

export const TABLE_CATEGORY_LABELS: Record<TableCategory, string> = {
	snippets: 'Snippets',
	recipes: 'Recipes',
	appRules: 'App rules',
};

export type SettingsCategory = PreferenceCategory | TableCategory;
