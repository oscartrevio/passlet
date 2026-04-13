import { type NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
	const response = NextResponse.next();
	if (!request.cookies.get("passlet-id")) {
		const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
		response.cookies.set("passlet-id", id, {
			maxAge: 60 * 60 * 24 * 365,
			path: "/",
		});
	}
	return response;
}
