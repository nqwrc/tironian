import { DICTATION_BASE_PATHNAME } from '#platform/base-path';
import type { TironianSoundNames } from '$lib/constants/sounds';
import blipSoundSrc from './sound_ex_machina_Button_Blip.mp3';
import stopVadSoundSrc from './zapsplat_household_alarm_clock_large_snooze_button_press_001_12968.mp3';
import startVadSoundSrc from './zapsplat_household_alarm_clock_large_snooze_button_press_002_12969.mp3';
import cancelSoundSrc from './zapsplat_multimedia_click_button_short_sharp_73510.mp3';
import recipeCompleteSoundSrc from './zapsplat_multimedia_notification_alert_ping_bright_chime_001_93276.mp3';

// The Wispr Flow-style recording overlay pill wants its own start/stop/paste
// chimes (`research/06_live_widget_and_settings_spec.md` 2.1). `manual-start`,
// `manual-stop`, and `transcriptionComplete` already fire at exactly those
// three moments (`operations/recording.ts`, `operations/pipeline.ts`), both
// for the manual trigger this pill drives, so pointing those three entries at
// the new static assets is the whole change: no new sound name, no settings
// schema churn, and no double playback (the cue still fires exactly once,
// from the main window that owns the dictation pipeline; the overlay webview
// never plays sound itself). `playSoundUrl` (`services/sound/index.ts`)
// fetches by URL, so a `static/` path works the same as a bundled import.
//
// These three are `static/` rather than bundled imports on purpose: the audio is
// not committed, and a bundled import of a missing file fails the build for
// everyone instead of degrading to silence on the one machine that has it. That
// is also why the base is spelled out here. Vite rewrites the base into the URL of
// an imported asset, but a hand-written absolute path is emitted verbatim, and
// under the desktop host this app is served from `/apps/dictation`
// (`svelte.config.js`), so the bare `/sounds/...` form resolved against the host
// root and 404'd on every dictation.
const wisprStartSoundSrc = `${DICTATION_BASE_PATHNAME}/sounds/wispr/dictation-start.wav`;
const wisprStopSoundSrc = `${DICTATION_BASE_PATHNAME}/sounds/wispr/dictation-stop.wav`;
const wisprPasteSoundSrc = `${DICTATION_BASE_PATHNAME}/sounds/wispr/paste.wav`;

export const soundSources = {
	'manual-start': wisprStartSoundSrc,
	'manual-cancel': cancelSoundSrc,
	'manual-stop': wisprStopSoundSrc,
	'vad-start': startVadSoundSrc,
	'vad-capture': blipSoundSrc,
	'vad-stop': stopVadSoundSrc,
	transcriptionComplete: wisprPasteSoundSrc,
	recipeComplete: recipeCompleteSoundSrc,
} satisfies Record<TironianSoundNames, string>;
