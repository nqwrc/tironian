/**
 * How long a global-chord action waits for the chord's modifier keys to lift
 * before it synthesizes a keystroke of its own (`waitForModifiersReleased`).
 * Long enough for a normal release, short enough that a held key is noticed.
 */
export const MODIFIER_RELEASE_WAIT_MS = 600;
