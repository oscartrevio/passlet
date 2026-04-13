import type { Metadata, Viewport } from "next";

export const SITE_MANIFEST = {
	name: "Passlet",
	short_name: "Passlet",
	description: "One API for Apple Wallet and Google Wallet passes.",
	start_url: "/",
	display: "standalone" as const,
	background_color: "#FAFAFA",
	theme_color: "#FAFAFA",
	url: "https://passlet.oscartrevio.xyz",
	author: {
		name: "Oscar Treviño",
		twitter: "@oscartrevio_",
		url: "https://twitter.com/oscartrevio_",
	},
	github: "https://github.com/oscartrevio/passlet",
};

export const METADATA: Metadata = {
	metadataBase: new URL(SITE_MANIFEST.url),
	title: {
		default: SITE_MANIFEST.name,
		template: "%s",
	},
	description: SITE_MANIFEST.description,
	keywords: [
		"passlet",
		"apple wallet",
		"google wallet",
		"digital wallet",
		"pass management",
		"loyalty cards",
		"event tickets",
		"boarding passes",
		"API for wallets",
		"pass creation",
		"pass distribution",
		"wallet integration",
	],
	authors: [{ name: SITE_MANIFEST.author.name, url: SITE_MANIFEST.author.url }],
	creator: SITE_MANIFEST.author.name,
	openGraph: {
		type: "website",
		locale: "en_US",
		url: SITE_MANIFEST.url,
		siteName: SITE_MANIFEST.name,
		title: SITE_MANIFEST.name,
		description: SITE_MANIFEST.description,
		images: [
			{
				url: "/og/default.png",
				width: 1200,
				height: 630,
				alt: SITE_MANIFEST.name,
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: SITE_MANIFEST.name,
		description: SITE_MANIFEST.description,
		creator: SITE_MANIFEST.author.twitter,
		images: ["/og/default.png"],
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-video-preview": -1,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
	},
	alternates: {
		canonical: SITE_MANIFEST.url,
		types: {
			"application/rss+xml": `${SITE_MANIFEST.url}/feed.xml`,
		},
	},
};

export const VIEWPORT: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: dark)", color: SITE_MANIFEST.theme_color },
		{
			media: "(prefers-color-scheme: light)",
			color: SITE_MANIFEST.background_color,
		},
	],
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
};
