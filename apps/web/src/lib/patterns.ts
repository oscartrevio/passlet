import type { PatternType } from "./data";

export const STROKE_WIDTH = 10;
const DOT_RADIUS = 8;
export const STROKE_PATTERNS = new Set<PatternType>(["waves", "zigzag"]);

export const STRIP_W = 256;
export const STRIP_H = 104;
export const SWATCH_W = 30;
export const SWATCH_H = 22;

export function buildWaves(
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

export function buildZigzag(
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

export function buildChessboard(
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

export function buildDots(
	W: number,
	H: number,
	opts?: { targetSp?: number }
): string {
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

// Renders the selected pattern at @2x (750×196) as a transparent PNG,
// replicating the CardStrip SVG filter via canvas compositing:
//   - Outer white glow below the path  (feComposite operator="out")
//   - Dark inset shadow inside the path (feComposite operator="arithmetic" inset)
// Parameters are doubled so visual density matches the card preview at 375pt.
export function captureBannerBytes(pattern: PatternType): Promise<string> {
	const W = 750;
	const H = 196;
	const SW = STROKE_WIDTH * 2;

	const pathBuilders: Record<PatternType, () => string> = {
		waves: () => buildWaves(W, H, { targetWl: 70, targetSp: 40, amp: 10 }),
		zigzag: () => buildZigzag(W, H, { targetWl: 48, targetSp: 40, amp: 12 }),
		chessboard: () => buildChessboard(W, H, { targetSq: 40 }),
		dots: () => buildDots(W, H, { targetSp: 48 }),
	};
	const path = new Path2D(pathBuilders[pattern]());
	const isStroke = STROKE_PATTERNS.has(pattern);

	const draw = (ctx: CanvasRenderingContext2D, color: string) => {
		ctx.save();
		if (isStroke) {
			ctx.strokeStyle = color;
			ctx.lineWidth = SW;
			ctx.stroke(path);
		} else {
			ctx.fillStyle = color;
			ctx.fill(path);
		}
		ctx.restore();
	};

	const offscreen = (fn: (ctx: CanvasRenderingContext2D) => void) => {
		const el = document.createElement("canvas");
		el.width = W;
		el.height = H;
		const ctx = el.getContext("2d");
		if (!ctx) {
			throw new Error("Canvas 2D context unavailable.");
		}
		fn(ctx);
		return el;
	};

	// Outer white glow — draw path with shadow, then erase the path shape
	// so only the glow that bleeds outside the path boundary remains.
	const outerGlow = offscreen((ctx) => {
		ctx.shadowColor = "rgba(255,255,255,0.15)";
		ctx.shadowOffsetY = 2;
		ctx.shadowBlur = 2;
		draw(ctx, "white");
		ctx.shadowColor = "transparent";
		ctx.globalCompositeOperation = "destination-out";
		draw(ctx, "white");
	});

	// Dark inset shadow — draw dark path shifted down, then clip it
	// to the interior of the original path shape.
	const insetShadow = offscreen((ctx) => {
		ctx.shadowColor = "rgba(0,0,0,0.15)";
		ctx.shadowOffsetY = -2;
		ctx.shadowBlur = 2;
		draw(ctx, "white");
		ctx.shadowColor = "transparent";
		ctx.globalCompositeOperation = "destination-out";
		draw(ctx, "white");
	});

	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Canvas 2D context unavailable.");
	}
	ctx.drawImage(outerGlow, 0, 0);
	ctx.drawImage(insetShadow, 0, 0);

	outerGlow.width = 0;
	insetShadow.width = 0;

	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			canvas.width = 0;
			if (!blob) {
				reject(new Error("Failed to export banner image."));
				return;
			}
			const reader = new FileReader();
			reader.onload = () => resolve((reader.result as string).split(",")[1]);
			reader.readAsDataURL(blob);
		}, "image/png");
	});
}
