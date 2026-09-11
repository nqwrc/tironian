import { createHandsFree } from './hands-free';
import { pushToTalk } from './push-to-talk';

/**
 * The one production hands-free instance, shared by `commands.ts` (which
 * drives it on every Pressed/Released) and `ui-session.ts` (which disposes it
 * on teardown so a torn-down session cannot leave the next one starting
 * locked). Its own tiny module rather than a singleton exported from
 * `commands.ts`: `ui-session.ts` importing the UI-facing command registry
 * just to reach this would be a layering inversion, and `hands-free.ts` stays
 * pure (see its own doc comment) by not building the real instance itself.
 */
export const handsFreePushToTalk = createHandsFree(pushToTalk);
