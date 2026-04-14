import type { Metadata } from "next";
import { cookies } from "next/headers";
import { fonts } from "@/lib/fonts";
import { METADATA, VIEWPORT } from "@/lib/site";

import "../index.css";

export const viewport = VIEWPORT;

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

export async function generateMetadata(): Promise<Metadata> {
	const cookieStore = await cookies();
	const raw = cookieStore.get("passlet-color")?.value ?? "blue";
	const color = VALID_COLORS.has(raw) ? raw : "blue";
	return {
		...METADATA,
		icons: { icon: `/favicon/favicon-${color}.svg` },
	};
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className={`${fonts} min-h-full bg-white antialiased`}>
				{children}
			</body>
		</html>
	);
}
