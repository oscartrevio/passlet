import type { PatternType } from "./data";

export const STROKE_WIDTH = 10;
const DOT_RADIUS = 8;
export const STROKE_PATTERNS = new Set<PatternType>(["waves", "zigzag"]);

export const STRIP_W = 256;
export const STRIP_H = 104;
export const SWATCH_W = 30;
export const SWATCH_H = 22;

function buildWaves(
	W: number,
	H: number,
	opts?: { targetWl?: number; targetSp?: number; amp?: number }
): string {
	const targetWl = opts?.targetWl ?? 35;
	const targetSp = opts?.targetSp ?? 20;
	const amp = opts?.amp ?? 5;
	const segs = Math.round(W / targetWl);
	const rows = Math.round(H / targetSp);
	const wl = W / segs;
	const sp = H / rows;
	const hw = wl / 2;
	const parts: string[] = [];
	for (let r = 0; r < rows; r++) {
		const y = sp * (r + 0.5);
		let d = `M${-wl} ${y}`;
		for (let i = -1; i <= segs; i++) {
			const x = i * wl;
			d += ` C${x + hw / 3} ${y - amp} ${x + (2 * hw) / 3} ${y - amp} ${x + hw} ${y}`;
			d += ` C${x + hw + hw / 3} ${y + amp} ${x + hw + (2 * hw) / 3} ${y + amp} ${x + wl} ${y}`;
		}
		parts.push(d);
	}
	return parts.join(" ");
}

function buildZigzag(
	W: number,
	H: number,
	opts?: { targetWl?: number; targetSp?: number; amp?: number }
): string {
	const targetWl = opts?.targetWl ?? 24;
	const targetSp = opts?.targetSp ?? 20;
	const amp = opts?.amp ?? 6;
	const segs = Math.round(W / targetWl);
	const rows = Math.round(H / targetSp);
	const wl = W / segs;
	const sp = H / rows;
	const hw = wl / 2;
	const parts: string[] = [];
	for (let r = 0; r < rows; r++) {
		const y = sp * (r + 0.5) + amp;
		let d = `M${-wl} ${y}`;
		for (let i = -1; i <= segs; i++) {
			const x = i * wl;
			d += ` L${x + hw} ${y - amp} L${x + wl} ${y}`;
		}
		parts.push(d);
	}
	return parts.join(" ");
}

function buildChessboard(
	W: number,
	H: number,
	opts?: { targetSq?: number }
): string {
	const targetSq = opts?.targetSq ?? 20;
	const cols = Math.round(W / targetSq);
	const rowCount = Math.round(H / targetSq);
	const sqW = W / cols;
	const sqH = H / rowCount;
	const parts: string[] = [];
	for (let row = 0; row < rowCount; row++) {
		const startCol = row % 2 === 0 ? 0 : 1;
		for (let col = startCol; col < cols; col += 2) {
			const x = col * sqW;
			const y = row * sqH;
			parts.push(
				`M${x} ${y} L${x + sqW} ${y} L${x + sqW} ${y + sqH} L${x} ${y + sqH} Z`
			);
		}
	}
	return parts.join(" ");
}

function buildDots(W: number, H: number, opts?: { targetSp?: number }): string {
	const targetSp = opts?.targetSp ?? 24;
	const cols = Math.round(W / targetSp);
	const rows = Math.round(H / targetSp);
	const spX = W / cols;
	const spY = H / rows;
	const parts: string[] = [];
	for (let row = 0; row < rows; row++) {
		const offsetX = row % 2 === 0 ? 0 : spX / 2;
		const cy = spY * (row + 0.5);
		for (let col = 0; col < cols + 1; col++) {
			const cx = spX * col + offsetX;
			parts.push(
				`M${cx - DOT_RADIUS} ${cy} a${DOT_RADIUS},${DOT_RADIUS} 0 1,0 ${DOT_RADIUS * 2},0 a${DOT_RADIUS},${DOT_RADIUS} 0 1,0 ${-DOT_RADIUS * 2},0`
			);
		}
	}
	return parts.join(" ");
}

export const STRIP_PATHS: Record<PatternType, string> = {
	waves: buildWaves(STRIP_W, STRIP_H),
	zigzag: buildZigzag(STRIP_W, STRIP_H),
	chessboard: buildChessboard(STRIP_W, STRIP_H),
	dots: buildDots(STRIP_W, STRIP_H),
};

export const SWATCH_PATHS: Record<PatternType, string> = {
	waves: buildWaves(SWATCH_W, SWATCH_H, { targetWl: 26, targetSp: 18, amp: 4 }),
	zigzag: buildZigzag(SWATCH_W, SWATCH_H, {
		targetWl: 14,
		targetSp: 16,
		amp: 6,
	}),
	chessboard: buildChessboard(SWATCH_W, SWATCH_H, { targetSq: 10 }),
	dots: buildDots(SWATCH_W, SWATCH_H, { targetSp: 18 }),
};

// Apple gives store card strips 375×144 pt (Wallet fills the slot and crops
// if a device uses a shorter one). Wallet only draws the image, so it has to
// carry the same look as the on-page preview: the pass colour with the
// pattern laid over it in the secondary colour at 50%. The pattern is built in
// the preview's 256-wide coordinate space and scaled up, so stripes, dots and
// squares keep the size they have on screen.
const APPLE_STRIP_W = 375;
const APPLE_STRIP_H = 144;

const PATTERN_BUILDERS: Record<PatternType, (W: number, H: number) => string> =
	{
		waves: buildWaves,
		zigzag: buildZigzag,
		chessboard: buildChessboard,
		dots: buildDots,
	};

/** Base64 PNGs for strip.png, strip@2x.png and strip@3x.png. */
export interface StripImages {
	base: string;
	retina: string;
	superRetina: string;
}

export function captureStripImages(
	pattern: PatternType,
	colors: { background: string; pattern: string }
): StripImages {
	const previewH = (STRIP_W * APPLE_STRIP_H) / APPLE_STRIP_W;
	const path = new Path2D(PATTERN_BUILDERS[pattern](STRIP_W, previewH));
	return {
		base: renderStrip(path, pattern, colors, 1),
		retina: renderStrip(path, pattern, colors, 2),
		superRetina: renderStrip(path, pattern, colors, 3),
	};
}

function renderStrip(
	path: Path2D,
	pattern: PatternType,
	colors: { background: string; pattern: string },
	scale: number
): string {
	const canvas = document.createElement("canvas");
	canvas.width = APPLE_STRIP_W * scale;
	canvas.height = APPLE_STRIP_H * scale;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Canvas 2D context unavailable.");
	}

	ctx.fillStyle = colors.background;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.scale(canvas.width / STRIP_W, canvas.width / STRIP_W);
	ctx.globalAlpha = 0.5;
	if (STROKE_PATTERNS.has(pattern)) {
		ctx.strokeStyle = colors.pattern;
		ctx.lineWidth = STROKE_WIDTH;
		ctx.stroke(path);
	} else {
		ctx.fillStyle = colors.pattern;
		ctx.fill(path);
	}

	return canvas.toDataURL("image/png").split(",")[1];
}
