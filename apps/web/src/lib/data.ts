export type PatternType = "waves" | "zigzag" | "chessboard" | "dots";

// Pass presets come from Radix Colors (light scales): the fill is the solid
// step 9, the strip pattern uses step 11, and the text is Radix's pairing for
// step 9 (white, or step 12 on bright Amber). Midnight and Sand are neutrals
// with no step-9 solid, so they use Slate 12 and Brown 3 instead. `ring`
// outlines the selected swatch: the fill itself, except on Sand, whose fill
// is too close to the page, so it takes Brown 8.
export const COLORS = [
	{
		label: "Green",
		value: "green",
		color: "#30A46C",
		secondary: "#218358",
		text: "#FFFFFF",
		subtle: "rgba(255,255,255,0.45)",
		ring: "#30A46C",
	},
	{
		label: "Amber",
		value: "amber",
		color: "#FFC53D",
		secondary: "#AB6400",
		text: "#4F3422",
		subtle: "rgba(79,52,34,0.45)",
		ring: "#FFC53D",
	},
	{
		label: "Orange",
		value: "orange",
		color: "#F76B15",
		secondary: "#CC4E00",
		text: "#FFFFFF",
		subtle: "rgba(255,255,255,0.45)",
		ring: "#F76B15",
	},
	{
		label: "Red",
		value: "red",
		color: "#E5484D",
		secondary: "#CE2C31",
		text: "#FFFFFF",
		subtle: "rgba(255,255,255,0.45)",
		ring: "#E5484D",
	},
	{
		label: "Purple",
		value: "purple",
		color: "#8E4EC6",
		secondary: "#8145B5",
		text: "#FFFFFF",
		subtle: "rgba(255,255,255,0.45)",
		ring: "#8E4EC6",
	},
	{
		label: "Blue",
		value: "blue",
		color: "#0090FF",
		secondary: "#0D74CE",
		text: "#FFFFFF",
		subtle: "rgba(255,255,255,0.45)",
		ring: "#0090FF",
	},
	{
		label: "Midnight",
		value: "midnight",
		color: "#1C2024",
		secondary: "#60646C",
		text: "#FFFFFF",
		subtle: "rgba(255,255,255,0.45)",
		ring: "#1C2024",
	},
	{
		label: "Sand",
		value: "sand",
		color: "#F6EEE7",
		secondary: "#EBDACA",
		text: "#3E332E",
		subtle: "rgba(62,51,46,0.45)",
		ring: "#DCBC9F",
	},
] as const;

export type ColorValue = (typeof COLORS)[number]["value"];

export const DEFAULT_COLOR: ColorValue = "blue";

export function isColorValue(value: string): value is ColorValue {
	return COLORS.some((color) => color.value === value);
}

export const PATTERNS: { value: PatternType; label: string }[] = [
	{ value: "waves", label: "Waves" },
	{ value: "zigzag", label: "Zigzag" },
	{ value: "chessboard", label: "Chess" },
	{ value: "dots", label: "Dots" },
];
