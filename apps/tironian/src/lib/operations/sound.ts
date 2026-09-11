import { Ok, type Result } from 'wellcrafted/result';
import type { TironianApp } from '$lib/app/app';
import type { TironianSoundNames } from '$lib/constants/sounds';
import { services } from '$lib/services';
import type { SoundError } from '$lib/services/sound';

const soundSettingKeyMap = {
	'manual-start': 'soundManualStart',
	'manual-stop': 'soundManualStop',
	'manual-cancel': 'soundManualCancel',
	'vad-start': 'soundVadStart',
	'vad-capture': 'soundVadCapture',
	'vad-stop': 'soundVadStop',
	transcriptionComplete: 'soundTranscriptionComplete',
	recipeComplete: 'soundRecipeComplete',
} as const satisfies Record<TironianSoundNames, string>;

export async function playSoundIfEnabled(
	app: TironianApp,
	soundName: TironianSoundNames,
): Promise<Result<void, SoundError>> {
	if (!app.settings.get(soundSettingKeyMap[soundName])) {
		return Ok(undefined);
	}
	return services.sound.playSound(soundName);
}
