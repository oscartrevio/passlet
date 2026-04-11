import type { Metadata } from "next";
import { fonts } from "@/lib/fonts";

import "../index.css";

export const metadata: Metadata = {
	title: "Passlet",
	description: "One API for Apple Wallet and Google Wallet passes.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className={`${fonts} min-h-full antialiased`}>{children}</body>
		</html>
	);
}
