export type PatternType = "waves" | "zigzag" | "chessboard" | "dots";

export const COLORS = [
	{
		label: "Green",
		value: "green",
		color: "#16A34A",
		secondary: "#15803D",
		text: "#F0FFF4",
		muted: "rgba(240,255,244,0.7)",
		subtle: "rgba(240,255,244,0.45)",
	},
	{
		label: "Amber",
		value: "amber",
		color: "#F59E0B",
		secondary: "#D97706",
		text: "#FFFBEB",
		muted: "rgba(255,251,235,0.7)",
		subtle: "rgba(255,251,235,0.45)",
	},
	{
		label: "Orange",
		value: "orange",
		color: "#F97316",
		secondary: "#EA580C",
		text: "#FFF7ED",
		muted: "rgba(255,247,237,0.7)",
		subtle: "rgba(255,247,237,0.45)",
	},
	{
		label: "Red",
		value: "red",
		color: "#EF4444",
		secondary: "#DC2626",
		text: "#FFF0F0",
		muted: "rgba(255,240,240,0.7)",
		subtle: "rgba(255,240,240,0.45)",
	},
	{
		label: "Purple",
		value: "purple",
		color: "#9333EA",
		secondary: "#7E22CE",
		text: "#FAF5FF",
		muted: "rgba(250,245,255,0.7)",
		subtle: "rgba(250,245,255,0.45)",
	},
	{
		label: "Blue",
		value: "blue",
		color: "#2563EB",
		secondary: "#1D4ED8",
		text: "#EFF6FF",
		muted: "rgba(239,246,255,0.7)",
		subtle: "rgba(239,246,255,0.45)",
	},
	{
		label: "Midnight",
		value: "midnight",
		color: "#18181B",
		secondary: "#3F3F46",
		text: "#F4F4F5",
		muted: "rgba(244,244,245,0.7)",
		subtle: "rgba(244,244,245,0.45)",
	},
	{
		label: "Sand",
		value: "sand",
		color: "#F5EFE6",
		secondary: "#E5D9C8",
		text: "#44362A",
		muted: "rgba(68,54,42,0.7)",
		subtle: "rgba(68,54,42,0.45)",
	},
] as const;

export type ColorValue = (typeof COLORS)[number]["value"];

export const COLOR_VALUES = COLORS.map((color) => color.value) as ColorValue[];
export const DEFAULT_COLOR: ColorValue = "blue";

export function isColorValue(value: string): value is ColorValue {
	return COLOR_VALUES.includes(value as ColorValue);
}

export const PATTERNS: { value: PatternType; label: string }[] = [
	{ value: "waves", label: "Waves" },
	{ value: "zigzag", label: "Zigzag" },
	{ value: "chessboard", label: "Chess" },
	{ value: "dots", label: "Dots" },
];
