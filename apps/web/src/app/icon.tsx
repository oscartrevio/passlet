import { readFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const VALID_COLORS = new Set([
	"green",
	"amber",
	"orange",
	"red",
	"purple",
	"blue",
	"midnight",
	"sand",
]);

const DEFAULT_COLOR = "blue";

export default async function Icon() {
	const cookieStore = await cookies();
	const raw = cookieStore.get("passlet-color")?.value ?? DEFAULT_COLOR;
	const color = VALID_COLORS.has(raw) ? raw : DEFAULT_COLOR;

	const svg = await readFile(
		path.join(process.cwd(), "public", "favicon", `favicon-${color}.svg`)
	);
	const src = `data:image/svg+xml;base64,${svg.toString("base64")}`;

	return new ImageResponse(
		// biome-ignore lint/performance/noImgElement: ImageResponse does not support next/image
		<img alt="" height={32} src={src} width={32} />,
		{
			...size,
		}
	);
}
