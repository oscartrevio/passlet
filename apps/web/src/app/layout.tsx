import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PASSLET_COLOR_COOKIE } from "@/lib/cookies";
import { DEFAULT_COLOR, isColorValue } from "@/lib/data";
import { fonts } from "@/lib/fonts";
import { METADATA, VIEWPORT } from "@/lib/site";

import "../index.css";

export const viewport = VIEWPORT;

export async function generateMetadata(): Promise<Metadata> {
	const cookieStore = await cookies();
	const raw = cookieStore.get(PASSLET_COLOR_COOKIE)?.value;
	const color = raw && isColorValue(raw) ? raw : DEFAULT_COLOR;
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
			<body className={`${fonts} min-h-full bg-(--gray-a1) antialiased`}>
				{children}
				<Analytics />
			</body>
		</html>
	);
}
