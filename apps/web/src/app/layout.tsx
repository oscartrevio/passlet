import { fonts } from "@/lib/fonts";
import { METADATA, VIEWPORT } from "@/lib/site";

import "../index.css";

export const metadata = METADATA;
export const viewport = VIEWPORT;

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<link href="/icon" rel="icon" type="image/svg+xml" />
			</head>
			<body className={`${fonts} min-h-full bg-white antialiased`}>
				{children}
			</body>
		</html>
	);
}
