"use server";

import { cookies } from "next/headers";
import { COOKIE_MAX_AGE_ONE_YEAR, PASSLET_COLOR_COOKIE } from "@/lib/cookies";
import { isColorValue } from "@/lib/data";

export async function setPassletColor(color: string) {
	if (!isColorValue(color)) {
		return;
	}
	const cookieStore = await cookies();
	cookieStore.set(PASSLET_COLOR_COOKIE, color, {
		path: "/",
		maxAge: COOKIE_MAX_AGE_ONE_YEAR,
		sameSite: "lax",
	});
}
