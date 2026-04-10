import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { fonts } from "@/lib/fonts";

import "../index.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

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
			<body
				className={`${geistSans.variable} ${geistMono.variable} ${fonts} min-h-full font-open-runde antialiased`}
			>
				{children}
			</body>
		</html>
	);
}
