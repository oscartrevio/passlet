import localFont from "next/font/local";

const openRunde = localFont({
	variable: "--font-family-open-runde",
	src: [
		{
			path: "../public/fonts/OpenRunde-Regular.woff2",
			weight: "400",
			style: "normal",
		},
		{
			path: "../public/fonts/OpenRunde-Medium.woff2",
			weight: "500",
			style: "normal",
		},
		{
			path: "../public/fonts/OpenRunde-Semibold.woff2",
			weight: "600",
			style: "normal",
		},
		{
			path: "../public/fonts/OpenRunde-Bold.woff2",
			weight: "700",
			style: "normal",
		},
	],
	display: "swap",
});

export const fonts = [openRunde.variable].join(" ");
