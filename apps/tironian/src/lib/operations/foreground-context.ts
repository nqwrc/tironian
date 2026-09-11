/**
 * The foreground snapshot the recording operations take at capture start.
 *
 * The app in front when the user pressed the hotkey is what they were
 * dictating into, so routing decides from this moment and does not re-resolve
 * at delivery: a slow transcription plus an alt-tab must not silently reshape
 * the text for a window the user never spoke at. (The secure-field guard is
 * the opposite: it re-probes at paste time, because it protects wherever the
 * paste physically lands. See `operations/delivery.ts`.)
 *
 * The platform rides in the snapshot so the pipeline's rule matching stays a
 * pure function with no platform imports of its own.
 */
import { os } from '#platform/os';
import { services } from '$lib/services';
import type { AppRulePlatform } from './match-app-rule';

export type ForegroundSnapshot = {
	appId: string | null;
	platform: AppRulePlatform;
};

export async function captureForegroundSnapshot(): Promise<ForegroundSnapshot> {
	const platform: AppRulePlatform = os.isApple
		? 'macos'
		: os.isLinux
			? 'other'
			: 'windows';
	const { appId } = await services.context.getForegroundContext();
	return { appId, platform };
}
