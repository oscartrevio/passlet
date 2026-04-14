import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const cookieStore = await cookies();
	const raw = cookieStore.get("passlet-color")?.value ?? DEFAULT_COLOR;
	const color = VALID_COLORS.has(raw) ? raw : DEFAULT_COLOR;

	const { origin } = new URL(request.url);
	return NextResponse.redirect(`${origin}/favicon/favicon-${color}.svg`, {
		status: 302,
		headers: { "Cache-Control": "no-store" },
	});
}
