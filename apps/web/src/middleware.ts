import { type NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
	const response = NextResponse.next();
	if (!request.cookies.get("passlet-member-id")) {
		const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
		response.cookies.set("passlet-member-id", id, {
			maxAge: 60 * 60 * 24 * 365,
			path: "/",
		});
	}
	return response;
}
