export type PatternType = "waves" | "zigzag" | "chessboard" | "dots";

export const COLORS = [
	{
		label: "Green",
		value: "green",
		color: "#22C55E",
		text: "#F0FFF4",
		muted: "rgba(240,255,244,0.7)",
		subtle: "rgba(240,255,244,0.5)",
	},
	{
		label: "Amber",
		value: "amber",
		color: "#F59E0B",
		text: "#FFF7E6",
		muted: "rgba(255,247,230,0.72)",
		subtle: "rgba(255,247,230,0.5)",
	},
	{
		label: "Orange",
		value: "orange",
		color: "#F97316",
		text: "#FFF1E6",
		muted: "rgba(255,241,230,0.72)",
		subtle: "rgba(255,241,230,0.5)",
	},
	{
		label: "Red",
		value: "red",
		color: "#EF4444",
		text: "#FFEDED",
		muted: "rgba(255,237,237,0.72)",
		subtle: "rgba(255,237,237,0.5)",
	},
	{
		label: "Purple",
		value: "purple",
		color: "#A855F7",
		text: "#F4ECFF",
		muted: "rgba(244,236,255,0.72)",
		subtle: "rgba(244,236,255,0.5)",
	},
	{
		label: "Blue",
		value: "blue",
		color: "#3B82F6",
		text: "#EAF2FF",
		muted: "rgba(234,242,255,0.72)",
		subtle: "rgba(234,242,255,0.5)",
	},
	{
		label: "Midnight",
		value: "midnight",
		color: "#1C1C1E",
		text: "#E9E9F0",
		muted: "rgba(233,233,240,0.72)",
		subtle: "rgba(233,233,240,0.5)",
	},
	{
		label: "Sand",
		value: "sand",
		color: "#E8E1D5",
		text: "#4A3F2F",
		muted: "rgba(74,63,47,0.6)",
		subtle: "rgba(74,63,47,0.45)",
	},
] as const;

export type ColorValue = (typeof COLORS)[number]["value"];

export const PATTERNS: { value: PatternType; label: string }[] = [
	{ value: "waves", label: "Waves" },
	{ value: "zigzag", label: "Zigzag" },
	{ value: "chessboard", label: "Chess" },
	{ value: "dots", label: "Dots" },
];
