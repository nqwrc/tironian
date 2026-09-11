/**
 * The recording overlay's position, generalized from today's hardcoded
 * "centered, 72px above the bottom" formula into a 3x3 anchor grid with a
 * margin per axis. Pure and platform-free: the `.tauri.ts` window manager
 * converts monitor geometry to logical px before calling in here, and the
 * overlay page asks `snapRectToAnchor` what a dragged rect resolves to.
 *
 * See `specs/20260830T124813-repositionable-recording-pill.md`.
 */

export type XAnchor = 'left' | 'center' | 'right';
export type YAnchor = 'top' | 'center' | 'bottom';

export type OverlayAnchor = {
	xAnchor: XAnchor;
	xMarginPx: number;
	yAnchor: YAnchor;
	yMarginPx: number;
};

export type LogicalRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};
export type LogicalSize = { width: number; height: number };

/** Byte-for-byte today's hardcoded formula: centered, 72px above the bottom. */
export const DEFAULT_OVERLAY_ANCHOR: OverlayAnchor = {
	xAnchor: 'center',
	xMarginPx: 0,
	yAnchor: 'bottom',
	yMarginPx: 72,
};

/**
 * How close a drag has to land, in logical px, before it locks onto a
 * canonical placement.
 *
 * Generous on purpose. A tight threshold means most drops keep whatever margin
 * the hand happened to stop at, so finding a good spot is fiddly rather than
 * decisive. At 40 the nine canonical placements are what a drag falls into by
 * default, and free placement is the deliberate exception rather than the
 * common accident.
 */
export const SNAP_THRESHOLD_PX = 40;

/**
 * The one "comfortable distance from an edge" every edge snaps to. Reused
 * across all four edges rather than configured per edge: one value users learn
 * once, and it is today's own bottom margin, so the default keeps meaning the
 * same thing it always did.
 */
export const EDGE_SNAP_MARGIN_PX = 72;

/** Where an anchor+margin places a `size` window inside `monitorWorkArea`. */
export function resolveAnchorPosition(
	anchor: OverlayAnchor,
	monitorWorkArea: LogicalRect,
	size: LogicalSize,
): { x: number; y: number } {
	return {
		x: resolveAxisPosition(
			anchor.xAnchor,
			anchor.xMarginPx,
			monitorWorkArea.x,
			monitorWorkArea.width,
			size.width,
		),
		y: resolveAxisPosition(
			anchor.yAnchor,
			anchor.yMarginPx,
			monitorWorkArea.y,
			monitorWorkArea.height,
			size.height,
		),
	};
}

function resolveAxisPosition(
	anchor: XAnchor | YAnchor,
	marginPx: number,
	monitorPos: number,
	monitorSize: number,
	size: number,
): number {
	switch (anchor) {
		case 'left':
		case 'top':
			return monitorPos + marginPx;
		case 'center':
			return monitorPos + (monitorSize - size) / 2;
		case 'right':
		case 'bottom':
			return monitorPos + monitorSize - size - marginPx;
	}
}

/** An anchor plus whether each axis locked onto a canonical placement. */
export type SnapResult = {
	anchor: OverlayAnchor;
	/** True when the x axis sits on a canonical placement, not a free margin. */
	xSnapped: boolean;
	ySnapped: boolean;
};

/**
 * Reduce a dragged rect to a placement, preferring the canonical ones.
 *
 * Each axis has three canonical targets: the standard margin from the near
 * edge, centered, and the standard margin from the far edge. Land within
 * `SNAP_THRESHOLD_PX` of one and the axis locks onto it, which is what the
 * guide lines draw and what makes a drop feel decisive. Land outside every
 * target and the axis keeps its literal measured margin, so free placement
 * still exists; it is just no longer what an ordinary drag produces.
 *
 * The axes resolve independently, so every corner and edge midpoint is
 * reachable without having to satisfy both at once.
 */
export function snapRectToAnchor(
	windowRect: LogicalRect,
	monitorWorkArea: LogicalRect,
): SnapResult {
	const x = snapAxis(
		windowRect.x,
		windowRect.width,
		monitorWorkArea.x,
		monitorWorkArea.width,
		'left',
		'right',
	);
	const y = snapAxis(
		windowRect.y,
		windowRect.height,
		monitorWorkArea.y,
		monitorWorkArea.height,
		'top',
		'bottom',
	);
	return {
		anchor: {
			xAnchor: x.anchor,
			xMarginPx: x.marginPx,
			yAnchor: y.anchor,
			yMarginPx: y.marginPx,
		},
		xSnapped: x.snapped,
		ySnapped: y.snapped,
	};
}

function snapAxis<TSide extends string>(
	pos: number,
	size: number,
	monitorPos: number,
	monitorSize: number,
	nearSide: TSide,
	farSide: TSide,
): { anchor: TSide | 'center'; marginPx: number; snapped: boolean } {
	type AxisTarget = {
		anchor: TSide | 'center';
		marginPx: number;
		position: number;
	};
	// A fixed triple rather than an array, so the reduce below has a definite
	// starting target and no index can be undefined.
	const targets: [AxisTarget, AxisTarget, AxisTarget] = [
		{
			anchor: nearSide,
			marginPx: EDGE_SNAP_MARGIN_PX,
			position: monitorPos + EDGE_SNAP_MARGIN_PX,
		},
		{
			anchor: 'center',
			marginPx: 0,
			position: monitorPos + (monitorSize - size) / 2,
		},
		{
			anchor: farSide,
			marginPx: EDGE_SNAP_MARGIN_PX,
			position: monitorPos + monitorSize - size - EDGE_SNAP_MARGIN_PX,
		},
	];

	const nearest = targets.reduce((best, target) =>
		Math.abs(target.position - pos) < Math.abs(best.position - pos)
			? target
			: best,
	);
	const nearestDistance = Math.abs(nearest.position - pos);
	if (nearestDistance <= SNAP_THRESHOLD_PX) {
		return {
			anchor: nearest.anchor,
			marginPx: nearest.marginPx,
			snapped: true,
		};
	}

	const distanceFromNear = pos - monitorPos;
	const distanceFromFar = monitorPos + monitorSize - (pos + size);
	const isNearer = distanceFromNear <= distanceFromFar;
	return {
		anchor: isNearer ? nearSide : farSide,
		marginPx: Math.max(
			0,
			Math.round(isNearer ? distanceFromNear : distanceFromFar),
		),
		snapped: false,
	};
}

/**
 * Where each axis's guide line belongs, in the same space `position` is in:
 * along the pill's centre when that axis is centred, and along the edge the
 * anchor measures from otherwise. This is the line the eye reads as "aligned".
 */
export function guideLineOffsets(
	anchor: OverlayAnchor,
	position: { x: number; y: number },
	size: LogicalSize,
): { x: number; y: number } {
	return {
		x:
			anchor.xAnchor === 'center'
				? position.x + size.width / 2
				: anchor.xAnchor === 'left'
					? position.x
					: position.x + size.width,
		y:
			anchor.yAnchor === 'center'
				? position.y + size.height / 2
				: anchor.yAnchor === 'top'
					? position.y
					: position.y + size.height,
	};
}

/** A human label for the placement, for the Settings field and the drag label. */
export function formatAnchorLabel(anchor: OverlayAnchor): string {
	const base =
		anchor.xAnchor === 'center' && anchor.yAnchor === 'center'
			? 'Center'
			: `${capitalize(anchor.yAnchor)} ${capitalize(anchor.xAnchor)}`;

	const notes = [
		marginNote(anchor.xAnchor, anchor.xMarginPx),
		marginNote(anchor.yAnchor, anchor.yMarginPx),
	].filter((note): note is string => note !== null);

	return notes.length > 0 ? `${base} (${notes.join(', ')})` : base;
}

function marginNote(edge: XAnchor | YAnchor, marginPx: number): string | null {
	if (edge === 'center') return null;
	if (marginPx === EDGE_SNAP_MARGIN_PX) return null;
	if (marginPx === 0) return `flush with the ${edge} edge`;
	return `${marginPx}px from ${edge}`;
}

function capitalize<T extends string>(word: T): Capitalize<T> {
	return (word.charAt(0).toUpperCase() + word.slice(1)) as Capitalize<T>;
}
