import { ImageResponse } from "next/og";
import { COLORS, PATTERNS } from "@/lib/data";
import {
	PATTERN_BUILDERS,
	STRIP_W,
	STROKE_PATTERNS,
	STROKE_WIDTH,
} from "@/lib/patterns";

// Google Wallet only takes images by URL, so the pass pattern is served here
// as a PNG for the loyalty class's heroImage. Same recipe as the on-page strip
// and the Apple strip: pass colour, pattern in the secondary colour at 50%,
// built in the preview's 256-wide coordinates. Google recommends 1032×336.
const HERO_W = 1032;
const HERO_H = 336;

export const dynamicParams = false;

export function generateStaticParams() {
	return COLORS.flatMap((c) =>
		PATTERNS.map((p) => ({ color: c.value, pattern: p.value }))
	);
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ color: string; pattern: string }> }
) {
	const { color, pattern } = await params;
	const colors = COLORS.find((c) => c.value === color);
	const look = PATTERNS.find((p) => p.value === pattern);
	if (!(colors && look)) {
		return new Response("Not found", { status: 404 });
	}

	const previewH = (STRIP_W * HERO_H) / HERO_W;
	const d = PATTERN_BUILDERS[look.value](STRIP_W, previewH);
	const stroke = STROKE_PATTERNS.has(look.value);

	return new ImageResponse(
		<div style={{ display: "flex", width: "100%", height: "100%" }}>
			<svg
				aria-hidden="true"
				height={HERO_H}
				viewBox={`0 0 ${STRIP_W} ${previewH}`}
				width={HERO_W}
				xmlns="http://www.w3.org/2000/svg"
			>
				<rect fill={colors.color} height={previewH} width={STRIP_W} />
				<path
					d={d}
					fill={stroke ? "none" : colors.secondary}
					fillOpacity={0.5}
					stroke={stroke ? colors.secondary : "none"}
					strokeOpacity={0.5}
					strokeWidth={STROKE_WIDTH}
				/>
			</svg>
		</div>,
		{ width: HERO_W, height: HERO_H }
	);
}
