/**
 * Fixed overlay window size in logical pixels, shared by the window manager
 * (which creates and places the window) and the overlay page (which resolves
 * where a drag ended).
 *
 * The window must fit the pill's widest state (260px, `listening` in
 * RecordingPill) plus bleed room for the deep drop shadow and the recording
 * dot's radial glow, both painted as CSS inside the webview: the window itself
 * sets `shadow: false`, so anything that overflows the window rect is clipped,
 * not just visually cropped. ~20px of bleed on each side keeps the glow intact
 * without making the (always-on-top, click-swallowing) window much bigger than
 * the pill it hosts.
 */
export const OVERLAY_WIDTH = 300;
export const OVERLAY_HEIGHT = 72;
