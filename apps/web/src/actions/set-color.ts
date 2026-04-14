"use server";

import { cookies } from "next/headers";

export async function setPassletColor(color: string) {
	const cookieStore = await cookies();
	cookieStore.set("passlet-color", color, {
		path: "/",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax",
	});
}
1;
