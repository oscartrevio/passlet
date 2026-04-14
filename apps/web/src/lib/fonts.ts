import localFont from "next/font/local";

const openRunde = localFont({
	variable: "--font-open-runde",
	src: [
		{
			path: "../lib/fonts/OpenRunde-Regular.woff2",
			weight: "400",
			style: "normal",
		},
		{
			path: "../lib/fonts/OpenRunde-Medium.woff2",
			weight: "500",
			style: "normal",
		},
		{
			path: "../lib/fonts/OpenRunde-Semibold.woff2",
			weight: "600",
			style: "normal",
		},
		{
			path: "../lib/fonts/OpenRunde-Bold.woff2",
			weight: "700",
			style: "normal",
		},
	],
	display: "auto",
});

export const fonts = [openRunde.variable].join(" ");
