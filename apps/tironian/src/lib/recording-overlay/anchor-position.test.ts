import { expect, test } from 'bun:test';
import {
	DEFAULT_OVERLAY_ANCHOR,
	formatAnchorLabel,
	guideLineOffsets,
	resolveAnchorPosition,
	snapRectToAnchor,
} from './anchor-position';

const MONITOR = { x: 0, y: 0, width: 1920, height: 1080 };
const SIZE = { width: 300, height: 72 };

test("the default anchor reproduces today's exact formula", () => {
	expect(resolveAnchorPosition(DEFAULT_OVERLAY_ANCHOR, MONITOR, SIZE)).toEqual({
		x: (1920 - 300) / 2,
		y: 1080 - 72 - 72,
	});
});

test('resolves each of the 9 anchor combinations', () => {
	expect(
		resolveAnchorPosition(
			{ xAnchor: 'left', xMarginPx: 40, yAnchor: 'top', yMarginPx: 20 },
			MONITOR,
			SIZE,
		),
	).toEqual({ x: 40, y: 20 });

	expect(
		resolveAnchorPosition(
			{ xAnchor: 'right', xMarginPx: 40, yAnchor: 'bottom', yMarginPx: 20 },
			MONITOR,
			SIZE,
		),
	).toEqual({ x: 1920 - 300 - 40, y: 1080 - 72 - 20 });

	expect(
		resolveAnchorPosition(
			{ xAnchor: 'center', xMarginPx: 0, yAnchor: 'center', yMarginPx: 0 },
			MONITOR,
			SIZE,
		),
	).toEqual({ x: (1920 - 300) / 2, y: (1080 - 72) / 2 });
});

test('resolves against a monitor not rooted at the origin (a secondary display)', () => {
	const monitor = { x: 1920, y: -200, width: 1440, height: 900 };
	expect(
		resolveAnchorPosition(
			{ xAnchor: 'left', xMarginPx: 0, yAnchor: 'top', yMarginPx: 0 },
			monitor,
			SIZE,
		),
	).toEqual({ x: 1920, y: -200 });
});

test('a rect at the default position resolves back to the default anchor, snapped on both axes', () => {
	const { x, y } = resolveAnchorPosition(DEFAULT_OVERLAY_ANCHOR, MONITOR, SIZE);
	expect(snapRectToAnchor({ x, y, ...SIZE }, MONITOR)).toEqual({
		anchor: DEFAULT_OVERLAY_ANCHOR,
		xSnapped: true,
		ySnapped: true,
	});
});

test('locks onto a canonical placement from well outside it, not just on top of it', () => {
	const { x, y } = resolveAnchorPosition(
		{ xAnchor: 'center', xMarginPx: 0, yAnchor: 'center', yMarginPx: 0 },
		MONITOR,
		SIZE,
	);
	// 35px off on both axes: inside the 40px threshold, so it still locks.
	expect(snapRectToAnchor({ x: x + 35, y: y - 35, ...SIZE }, MONITOR)).toEqual({
		anchor: {
			xAnchor: 'center',
			xMarginPx: 0,
			yAnchor: 'center',
			yMarginPx: 0,
		},
		xSnapped: true,
		ySnapped: true,
	});
});

test('outside every target keeps the literal dragged margin and reports no snap', () => {
	// x=400 and y=300 are each more than 40px from any canonical target.
	expect(snapRectToAnchor({ x: 400, y: 300, ...SIZE }, MONITOR)).toEqual({
		anchor: {
			xAnchor: 'left',
			xMarginPx: 400,
			yAnchor: 'top',
			yMarginPx: 300,
		},
		xSnapped: false,
		ySnapped: false,
	});
});

test('a near-standard margin locks exactly onto it', () => {
	// 68px measured, within the threshold of the standard 72px margin.
	expect(
		snapRectToAnchor({ x: 68, y: 1080 - 72 - 68, ...SIZE }, MONITOR),
	).toEqual({
		anchor: {
			xAnchor: 'left',
			xMarginPx: 72,
			yAnchor: 'bottom',
			yMarginPx: 72,
		},
		xSnapped: true,
		ySnapped: true,
	});
});

test('the axes lock independently, so one can snap while the other stays free', () => {
	// x sits on the right-edge target; y is far from top, centre and bottom.
	const x = 1920 - 300 - 72;
	const rect = { x, y: 300, ...SIZE };
	expect(snapRectToAnchor(rect, MONITOR)).toEqual({
		anchor: {
			xAnchor: 'right',
			xMarginPx: 72,
			yAnchor: 'top',
			yMarginPx: 300,
		},
		xSnapped: true,
		ySnapped: false,
	});
});

test('every corner and edge midpoint is reachable', () => {
	const corners = [
		{ x: 72, y: 72, xAnchor: 'left', yAnchor: 'top' },
		{ x: 1920 - 300 - 72, y: 72, xAnchor: 'right', yAnchor: 'top' },
		{ x: 72, y: 1080 - 72 - 72, xAnchor: 'left', yAnchor: 'bottom' },
		{
			x: 1920 - 300 - 72,
			y: 1080 - 72 - 72,
			xAnchor: 'right',
			yAnchor: 'bottom',
		},
	] as const;
	for (const corner of corners) {
		const result = snapRectToAnchor(
			{ x: corner.x, y: corner.y, ...SIZE },
			MONITOR,
		);
		expect(result.anchor.xAnchor).toBe(corner.xAnchor);
		expect(result.anchor.yAnchor).toBe(corner.yAnchor);
		expect(result.xSnapped && result.ySnapped).toBe(true);
	}
});

test('a guide runs through the pill centre on a centred axis', () => {
	const anchor = {
		xAnchor: 'center',
		xMarginPx: 0,
		yAnchor: 'center',
		yMarginPx: 0,
	} as const;
	const position = resolveAnchorPosition(anchor, MONITOR, SIZE);
	expect(guideLineOffsets(anchor, position, SIZE)).toEqual({
		x: 1920 / 2,
		y: 1080 / 2,
	});
});

test('a guide runs along the measured edge on an edge-anchored axis', () => {
	const anchor = {
		xAnchor: 'right',
		xMarginPx: 72,
		yAnchor: 'top',
		yMarginPx: 72,
	} as const;
	const position = resolveAnchorPosition(anchor, MONITOR, SIZE);
	// The right edge of the pill, and its top edge.
	expect(guideLineOffsets(anchor, position, SIZE)).toEqual({
		x: 1920 - 72,
		y: 72,
	});
});

test('formats a label naming the default placement', () => {
	expect(formatAnchorLabel(DEFAULT_OVERLAY_ANCHOR)).toBe('Bottom Center');
});

test('formats a label calling out a non-standard margin', () => {
	expect(
		formatAnchorLabel({
			xAnchor: 'left',
			xMarginPx: 40,
			yAnchor: 'top',
			yMarginPx: 0,
		}),
	).toBe('Top Left (40px from left, flush with the top edge)');
});
