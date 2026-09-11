import { field } from '@tironian/data/definition';
/**
 * Whispering's inert data definition.
 *
 * Pure JSON: closed field descriptors and nothing that knows about
 * storage, sync or documents (ADR-0213). Runtimes own all of that.
 *
 * Three things about this file are decisions rather than transcription of the
 * old contract, and each is load-bearing.
 *
 * **Settings live in `kv`, not in a table.** They used to be one row at the
 * chosen id `'settings'`. A chosen row id is a nested container addressed by
 * the operation that created it, so two devices both writing settings on their
 * own boot path create two containers and map LWW discards one along with every
 * value in it. KV lives at a name-addressed root, where independent minting
 * converges (ADR-0216).
 *
 * **Transcripts stay in the row.** They are machine-produced, replaced
 * wholesale, and rendered in the recordings list, so nothing about them wants
 * per-character merging. That is the opposite of Honeycrisp's call for prose
 * (ADR-0207) and it is deliberate: a note is written by a person a character at
 * a time, a transcript arrives finished.
 *
 * **There are no optional fields.** A field has to be one type through the CRDT
 * attribute, the projection column and the row alike, and "absent" is not a SQL
 * type. What would have been optional is nullable with a `= null` default,
 * which a read applies and a write never stores.
 */

import type { DataView } from '@tironian/data';
import { defineData, type KvOf, type RowOf } from '@tironian/data/definition';

/** Runtime-minted structural row ids. */
export type RecordingId = string;
export type RecipeId = string;
export type SnippetId = string;

const recordingsTable = {
	/**
	 * Opaque identity for this recording's immutable audio in the local blob
	 * store.
	 *
	 * The pattern survives; the `BlobId` brand does not, because `RowOf` yields
	 * the field's own type and a brand is a TypeScript fiction the CRDT never
	 * saw. Re-brand with `parseBlobId` where a row meets the blob store.
	 */
	audioBlobId: field.string({ pattern: '^blob_[a-z0-9]{21}$' }),
	/**
	 * Historical: set only by a since-removed replica-upload workflow. Nothing
	 * writes it any more; kept so a row from before the cut still conforms
	 * instead of losing its other fields to the diagnostic.
	 */
	uploadedAt: field.nullable(field.instant()),
	title: field.string(),
	recordedAt: field.instant(),
	recordedAtZone: field.string(),
	transcript: field.string(),
	polishedTranscript: field.nullable(field.string()),
	duration: field.nullable(field.number()),
	/**
	 * The transcription outcome, flattened into three columns.
	 *
	 * It was one nullable discriminated union, and a workspace cannot express an
	 * inline object: `'{ status: ... }'` does not parse, and `'object|null'`
	 * parses but validates nothing and makes the whole outcome one LWW value.
	 * Three columns keep every field checked and let a failure's message merge
	 * independently of its timestamp.
	 */
	transcriptionStatus: field.string(),
	transcriptionCompletedAt: field.nullable(field.instant()),
	transcriptionError: field.nullable(field.string()),
} as const;

const recipesTable = {
	/**
	 * No `sourceId`. It existed because the old store let an application choose
	 * a row id and a recipe needed a portable one; the store now refuses chosen
	 * ids by construction (ADR-0206), so a user recipe's identity IS its minted
	 * row id. Built-in recipes keep their `builtin:` ids and remain non-rows.
	 */
	name: field.string(),
	instructions: field.string(),
	icon: field.nullable(field.string()),
	/**
	 * Whether these instructions may speak with the application's authority.
	 *
	 * A recipe's instructions are a directive, not content: they occupy the slot
	 * in `buildRecipeSystemPrompt` that decides what the model does with the
	 * text, and a per-app rule can auto-run one over every dictation and paste
	 * the result at the cursor. That is the person's own authority when the
	 * person wrote them, and somebody else's when the row came out of a settings
	 * bundle, which is a file whose author need not be the person importing it.
	 * So where the directive came from is stored with the directive: `false`
	 * demotes it into a delimited block the fixed rules outrank.
	 *
	 * It rides the row rather than a device setting because recipes travel
	 * (ADR-0233). A trust list kept per device would demote, on the second
	 * machine, a recipe the person wrote on the first.
	 */
	trusted: field.boolean(),
} as const;

const snippetsTable = {
	/** What the person says. Matched whole-word and case-insensitively. */
	trigger: field.string(),
	/** What gets delivered, verbatim. Plain text: delivery has no rich text. */
	replacement: field.string(),
} as const;

/**
 * A per-application dictation rule: when the foreground app at recording start
 * matches, the rule reshapes what Polish is told and may auto-run a recipe.
 *
 * One rule carries both platform identifiers, so a "Terminal" rule syncs
 * across devices (ADR-0233) and simply never matches on a platform whose
 * field is null. Matching is a pure function (`operations/match-app-rule.ts`).
 */
const appRulesTable = {
	/** What the person calls this rule ("Terminal", "Email"). */
	name: field.string(),
	/** Lowercased exe file name matched on Windows ("wt.exe"), or null. */
	matchWindowsExe: field.nullable(field.string()),
	/** Bundle identifier matched on macOS ("com.googlecode.iterm2"), or null. */
	matchMacosBundleId: field.nullable(field.string()),
	/**
	 * Replaces the global Polish directive inside its fixed anti-injection
	 * scaffold (`buildPolishSystemPrompt`); null keeps the global directive.
	 */
	polishInstructions: field.nullable(field.string()),
	/**
	 * A recipe auto-run over the polished text: a `builtin:` id or a recipes
	 * row id; null for none. Resolved at use; a dangling id degrades to plain
	 * Polish rather than failing the dictation.
	 */
	recipeId: field.nullable(field.string()),
	enabled: field.boolean(),
	/**
	 * Whether `polishInstructions` may command the pass, on the recipes table's
	 * terms and for the same reason: a rule minted by a settings bundle carries
	 * a directive the person did not write, and this rule's directive replaces
	 * the global one over every dictation into the app it matches.
	 *
	 * `enabled` is a different question. Off means the rule does not run at all,
	 * which is where an imported rule starts; `trusted` decides what its
	 * directive is allowed to be once it does. Turning a rule on is not the same
	 * act as vouching for the words inside it.
	 */
	trusted: field.boolean(),
} as const;

/**
 * A shortcut, as two fields.
 *
 * Same gap as the transcription outcome: a `{ modifiers, keys }` object has no
 * string expression. There is no lossless label codec in `utils/key-binding.ts`
 * either (`keyBindingToLabel` and `keyBindingToAccelerator` are one-way), so a
 * canonical single-string encoding would have to be invented and tested. Two
 * arrays need neither.
 *
 * Nullable rather than optional, because missing remains a conformance error and
 * initialization belongs to the application. Every array field uses this same law.
 */
const shortcut = {
	modifiers: field.nullable(
		field.multiSelect(['ctrl', 'alt', 'shift', 'meta', 'fn']),
	),
	keys: field.nullable(field.tags()),
} as const;

const settingsKv = {
	soundManualStart: field.boolean(),
	soundManualStop: field.boolean(),
	soundManualCancel: field.boolean(),
	soundVadStart: field.boolean(),
	soundVadCapture: field.boolean(),
	soundVadStop: field.boolean(),
	soundTranscriptionComplete: field.boolean(),
	soundRecipeComplete: field.boolean(),

	outputTranscriptionClipboard: field.boolean(),
	outputTranscriptionCursor: field.boolean(),
	outputTranscriptionEnter: field.boolean(),
	outputRecipeClipboard: field.boolean(),
	outputRecipeCursor: field.boolean(),
	outputRecipeEnter: field.boolean(),

	recordingTrigger: field.select(['vad', 'manual']),
	recordingPausePlayback: field.boolean(),

	/**
	 * Where the floating recording pill sits, as a 3x3 anchor grid with a margin
	 * per axis rather than one hardcoded formula. The defaults reproduce the
	 * formula this replaced: centered, 72px above the usable bottom edge.
	 */
	recordingOverlayXAnchor: field.select(['left', 'center', 'right']),
	recordingOverlayXMarginPx: field.number(),
	recordingOverlayYAnchor: field.select(['top', 'center', 'bottom']),
	recordingOverlayYMarginPx: field.number(),

	transcriptionService: field.select([
		'OpenAI',
		'Groq',
		'ElevenLabs',
		'Deepgram',
		'Mistral',
		'local',
		'speaches',
	]),
	transcriptionOpenaiModel: field.string(),
	transcriptionGroqModel: field.string(),
	transcriptionElevenlabsModel: field.string(),
	transcriptionDeepgramModel: field.string(),
	transcriptionMistralModel: field.string(),
	/**
	 * A plain string, not a union of the 58 supported languages.
	 *
	 * A hand-written union here would drift from `constants/languages.ts`, and
	 * drift means the declaration refusing a write the UI offered. The app validates
	 * against the const; the three SMALL selects above are spelled out because
	 * a two-to-eight-member union is worth checking at the storage boundary.
	 */
	/**
	 * The language the interface speaks, which is a different question from
	 * {@link transcriptionLanguage}: that one is what the speaker says, this one is
	 * what the app says back. Someone dictating Italian into an English interface
	 * is an ordinary setup, so the two never derive from each other.
	 *
	 * A select rather than a string, unlike the transcription language: the app
	 * ships a fixed set of translated locales and the storage boundary is the right
	 * place to refuse one that has no messages behind it.
	 */
	interfaceLocale: field.select(['en', 'it']),
	transcriptionLanguage: field.string(),
	transcriptionPrompt: field.string(),

	completionProvider: field.select([
		'OpenAI',
		'Groq',
		'Anthropic',
		'Google',
		'OpenRouter',
		'Custom',
	]),
	completionModel: field.string(),

	dictionary: field.nullable(field.tags()),
	polishEnabled: field.boolean(),
	polishInstructions: field.string(),
	commandModeEnabled: field.boolean(),

	/**
	 * Withhold delivery when the focused element is a detected password field:
	 * no paste, no clipboard write, the transcript stays in history. Detection
	 * is best-effort and fail-open, so only an affirmative secure verdict
	 * withholds (`operations/secure-field-guard.ts`).
	 */
	secureFieldGuardEnabled: field.boolean(),
	/**
	 * Also refuse to start a recording while a detected password field has
	 * focus. Opt-in: this is the only gate that keeps a dictated secret from
	 * reaching a cloud transcription or Polish provider, but it is also the
	 * only one that can visibly refuse a recording, so it ships off.
	 */
	secureFieldCaptureGateEnabled: field.boolean(),
	analyticsEnabled: field.boolean(),

	shortcutPushToTalkModifiers: shortcut.modifiers,
	shortcutPushToTalkKeys: shortcut.keys,
	shortcutToggleManualRecordingModifiers: shortcut.modifiers,
	shortcutToggleManualRecordingKeys: field.nullable(field.tags()),
	shortcutCancelRecordingModifiers: shortcut.modifiers,
	shortcutCancelRecordingKeys: field.nullable(field.tags()),
	shortcutToggleVadRecordingModifiers: shortcut.modifiers,
	shortcutToggleVadRecordingKeys: field.nullable(field.tags()),
	shortcutOpenRecipePickerModifiers: shortcut.modifiers,
	shortcutOpenRecipePickerKeys: field.nullable(field.tags()),
	shortcutRunRecipeOnClipboardModifiers: shortcut.modifiers,
	shortcutRunRecipeOnClipboardKeys: field.nullable(field.tags()),
	shortcutOpenSettingsModifiers: shortcut.modifiers,
	shortcutOpenSettingsKeys: field.nullable(field.tags()),
} as const;

export const whisperingDefinition = defineData({
	id: 'app.tironian.dictation',
	title: 'Tironian',
	kv: settingsKv,
	tables: {
		recordings: recordingsTable,
		recipes: recipesTable,
		snippets: snippetsTable,
		appRules: appRulesTable,
	},
});

/** The typed view of one store through Whispering's workspace. */
export type WhisperingData = DataView<typeof whisperingDefinition>;

export type Recording = RowOf<typeof recordingsTable>;
export type Recipe = RowOf<typeof recipesTable>;
export type Snippet = RowOf<typeof snippetsTable>;
export type AppRule = RowOf<typeof appRulesTable>;
/**
 * The settings values an application composes after a read.
 *
 * Through `KvOf` rather than `typeof settingsKv`, which was the DECLARATION
 * (a record of descriptors) wearing the name of the values.
 */
export type WhisperingSettingValues = KvOf<typeof whisperingDefinition>;
