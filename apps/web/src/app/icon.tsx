import { cookies } from "next/headers";
import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const ACCENT_COLORS: Record<string, string> = {
	blue: "#0088ff",
	sky: "#00c0e8",
	teal: "#00c3d0",
	mint: "#00c8b3",
	green: "#34c759",
	indigo: "#6155f5",
	brown: "#ac7f5e",
	purple: "#cb30e0",
	pink: "#ff2d55",
	red: "#ff383c",
	orange: "#ff8d28",
	yellow: "#ffcc00",
};

export default async function Icon() {
	const cookieStore = await cookies();
	const accent = cookieStore.get("passlet-color")?.value ?? "blue";
	const fill = ACCENT_COLORS[accent] ?? ACCENT_COLORS.blue;

	return new ImageResponse(
		<div
			style={{
				width: 32,
				height: 32,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{/** biome-ignore lint/a11y/noSvgWithoutTitle: Title not needed here */}
			<svg
				fill="none"
				style={{ width: 24, height: 24 }}
				viewBox="0 0 100 100"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					d="M50,0 C10,0 0,10 0,50 C0,90 10,100 50,100 C90,100 100,90 100,50 C100,10 90,0 50,0 Z"
					fill={fill}
				/>
			</svg>
		</div>,
		{ ...size }
	);
}
