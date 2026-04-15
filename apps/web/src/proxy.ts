import { type NextRequest, NextResponse } from "next/server";
import { COOKIE_MAX_AGE_ONE_YEAR, PASSLET_ID_COOKIE } from "@/lib/cookies";

export function proxy(request: NextRequest) {
	const response = NextResponse.next();
	if (!request.cookies.get(PASSLET_ID_COOKIE)) {
		const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
		response.cookies.set(PASSLET_ID_COOKIE, id, {
			maxAge: COOKIE_MAX_AGE_ONE_YEAR,
			path: "/",
		});
	}
	return response;
}
