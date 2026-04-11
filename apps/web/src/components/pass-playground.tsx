"use client";

import { cn } from "@passlet/ui/lib/utils";
import { type CSSProperties, type ReactNode, useState } from "react";

const COLORS = [
	{
		label: "Green",
		value: "green",
		color: "#22C55E",
		text: "#F0FFF4",
		muted: "rgba(240, 255, 244, 0.7)",
		subtle: "rgba(240, 255, 244, 0.5)",
	},
	{
		label: "Amber",
		value: "amber",
		color: "#F59E0B",
		text: "#FFF7E6",
		muted: "rgba(255, 247, 230, 0.72)",
		subtle: "rgba(255, 247, 230, 0.5)",
	},
	{
		label: "Orange",
		value: "orange",
		color: "#F97316",
		text: "#FFF1E6",
		muted: "rgba(255, 241, 230, 0.72)",
		subtle: "rgba(255, 241, 230, 0.5)",
	},
	{
		label: "Red",
		value: "red",
		color: "#EF4444",
		text: "#FFEDED",
		muted: "rgba(255, 237, 237, 0.72)",
		subtle: "rgba(255, 237, 237, 0.5)",
	},
	{
		label: "Purple",
		value: "purple",
		color: "#A855F7",
		text: "#F4ECFF",
		muted: "rgba(244, 236, 255, 0.72)",
		subtle: "rgba(244, 236, 255, 0.5)",
	},
	{
		label: "Blue",
		value: "blue",
		color: "#3B82F6",
		text: "#EAF2FF",
		muted: "rgba(234, 242, 255, 0.72)",
		subtle: "rgba(234, 242, 255, 0.5)",
	},
	{
		label: "Midnight",
		value: "midnight",
		color: "#1C1C1E",
		text: "#E9E9F0",
		muted: "rgba(233, 233, 240, 0.72)",
		subtle: "rgba(233, 233, 240, 0.5)",
	},
	{
		label: "Sand",
		value: "sand",
		color: "#E8E1D5",
		text: "#4A3F2F",
		muted: "rgba(74, 63, 47, 0.6)",
		subtle: "rgba(74, 63, 47, 0.45)",
	},
] as const;

type ColorValue = (typeof COLORS)[number]["value"];

type PatternType = "waves" | "chessboard" | "dots" | "zigzag";

const PATTERNS: { value: PatternType; label: string }[] = [
	{ value: "waves", label: "Waves" },
	{ value: "zigzag", label: "Zigzag" },
	{ value: "chessboard", label: "Chess" },
	{ value: "dots", label: "Dots" },
];

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
function fmtDate(d: Date) {
	return `${MONTHS[d.getMonth()]}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

/* ─── Pattern path generators ─────────────────────────────── */

const WAVE_STROKE = 10;
const ZIGZAG_STROKE = 2;
const DOT_R = 3;

// Which patterns render as stroke vs fill
const STROKE_PATTERNS = new Set<PatternType>(["waves", "zigzag"]);

function buildWaves(W: number, H: number): string {
	const targetWl = 35;
	const targetSp = 20;
	const amp = 5;
	// Snap wavelength and row spacing so tiles fit exactly
	const segs = Math.round(W / targetWl);
	const rows = Math.round(H / targetSp);
	const wl = W / segs;
	const sp = H / rows;
	const hw = wl / 2;
	const parts: string[] = [];
	for (let r = 0; r < rows; r++) {
		const y = sp * (r + 0.5);
		// Start one segment before x=0 so stroke fills flush at left edge
		let d = `M${-wl} ${y}`;
		for (let i = -1; i <= segs; i++) {
			const x = i * wl;
			d += ` C${x + hw / 3} ${y - amp} ${x + (2 * hw) / 3} ${y - amp} ${x + hw} ${y}`;
			d += ` C${x + hw + hw / 3} ${y + amp} ${x + hw + (2 * hw) / 3} ${y + amp} ${x + wl} ${y}`;
		}
		parts.push(d);
	}
	return parts.join(" ");
}

function buildChessboard(W: number, H: number): string {
	const targetSq = 20;
	const cols = Math.round(W / targetSq);
	const rowCount = Math.round(H / targetSq);
	const sqW = W / cols;
	const sqH = H / rowCount;
	const parts: string[] = [];
	for (let row = 0; row < rowCount; row++) {
		const startCol = row % 2 === 0 ? 0 : 1;
		for (let col = startCol; col < cols; col += 2) {
			const x = col * sqW;
			const y = row * sqH;
			parts.push(
				`M${x} ${y} L${x + sqW} ${y} L${x + sqW} ${y + sqH} L${x} ${y + sqH} Z`
			);
		}
	}
	return parts.join(" ");
}

function buildDots(W: number, H: number): string {
	const targetSp = 18;
	const cols = Math.round(W / targetSp);
	const rows = Math.round(H / targetSp);
	const spX = W / cols;
	const spY = H / rows;
	const parts: string[] = [];
	for (let row = 0; row < rows; row++) {
		const offsetX = row % 2 === 0 ? 0 : spX / 2;
		const cy = spY * (row + 0.5);
		// One extra col to fill flush on offset rows
		for (let col = 0; col < cols + 1; col++) {
			const cx = spX * col + offsetX;
			parts.push(
				`M${cx - DOT_R} ${cy} a${DOT_R},${DOT_R} 0 1,0 ${DOT_R * 2},0 a${DOT_R},${DOT_R} 0 1,0 ${-DOT_R * 2},0`
			);
		}
	}
	return parts.join(" ");
}

function buildZigzag(W: number, H: number): string {
	const targetWl = 20;
	const targetSp = 18;
	const amp = 6;
	const segs = Math.round(W / targetWl);
	const rows = Math.round(H / targetSp);
	const wl = W / segs;
	const sp = H / rows;
	const hw = wl / 2;
	const parts: string[] = [];
	for (let r = 0; r < rows; r++) {
		const y = sp * (r + 0.5);
		let d = `M${-wl} ${y}`;
		for (let i = -1; i <= segs; i++) {
			const x = i * wl;
			d += ` L${x + hw} ${y - amp} L${x + wl} ${y}`;
		}
		parts.push(d);
	}
	return parts.join(" ");
}

/* ─── Precomputed paths ───────────────────────────────────── */
const STRIP_W = 256;
const STRIP_H = 104;

const STRIP_PATHS: Record<PatternType, string> = {
	waves: buildWaves(STRIP_W, STRIP_H),
	zigzag: buildZigzag(STRIP_W, STRIP_H),
	chessboard: buildChessboard(STRIP_W, STRIP_H),
	dots: buildDots(STRIP_W, STRIP_H),
};

const SWATCH_W = 30;
const SWATCH_H = 22;

const SWATCH_PATHS: Record<PatternType, string> = {
	waves: buildWaves(SWATCH_W, SWATCH_H),
	zigzag: buildZigzag(SWATCH_W, SWATCH_H),
	chessboard: buildChessboard(SWATCH_W, SWATCH_H),
	dots: buildDots(SWATCH_W, SWATCH_H),
};

function CardStrip({ pattern }: { pattern: PatternType }) {
	return (
		<svg
			aria-hidden="true"
			className="pointer-events-none w-full overflow-visible"
			fill="none"
			overflow="visible"
			viewBox={`0 0 ${STRIP_W} ${STRIP_H}`}
			xmlns="http://www.w3.org/2000/svg"
		>
			<defs>
				<filter
					colorInterpolationFilters="sRGB"
					filterUnits="userSpaceOnUse"
					height={STRIP_H + 2}
					id="strip-filter"
					width={STRIP_W}
					x="0"
					y="0"
				>
					{/* Outer white drop shadow — #FFFFFF1A 0px 0.5px 1px */}
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix
						in="SourceAlpha"
						result="hardAlpha"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
					/>
					<feOffset dy="1" />
					<feGaussianBlur stdDeviation="0.5" />
					<feComposite in2="hardAlpha" operator="out" />
					<feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.2 0" />
					<feBlend in2="BackgroundImageFix" result="shadow" />
					<feBlend in="SourceGraphic" in2="shadow" result="shape" />
					{/* Inner black shadow — #0000001A 0px 0.5px 1px inset */}
					<feColorMatrix
						in="SourceAlpha"
						result="hardAlpha"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
					/>
					<feOffset dy="1" />
					<feGaussianBlur stdDeviation="0.5" />
					<feComposite in2="hardAlpha" k2="-1" k3="1" operator="arithmetic" />
					<feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.2 0" />
					<feBlend in2="shape" />
				</filter>
			</defs>
			{STROKE_PATTERNS.has(pattern) ? (
				<path
					d={STRIP_PATHS[pattern]}
					fill="none"
					filter="url(#strip-filter)"
					stroke="white"
					strokeOpacity={0.01}
					strokeWidth={pattern === "zigzag" ? ZIGZAG_STROKE : WAVE_STROKE}
				/>
			) : (
				<path
					d={STRIP_PATHS[pattern]}
					fill="white"
					fillOpacity={0.01}
					filter="url(#strip-filter)"
					shapeRendering="crispEdges"
				/>
			)}
		</svg>
	);
}

function PatternSwatch({
	pattern,
	selected,
}: {
	pattern: PatternType;
	selected: boolean;
}) {
	return (
		<svg
			aria-hidden="true"
			height={SWATCH_H}
			viewBox={`0 0 ${SWATCH_W} ${SWATCH_H}`}
			width={SWATCH_W}
		>
			<rect
				fill={selected ? "#555" : "#C0C0C0"}
				height={SWATCH_H}
				rx={4}
				width={SWATCH_W}
			/>
			{STROKE_PATTERNS.has(pattern) ? (
				<path
					d={SWATCH_PATHS[pattern]}
					fill="none"
					stroke="white"
					strokeOpacity={selected ? 0.55 : 0.45}
					strokeWidth={pattern === "zigzag" ? ZIGZAG_STROKE : WAVE_STROKE}
				/>
			) : (
				<path
					d={SWATCH_PATHS[pattern]}
					fill="white"
					fillOpacity={selected ? 0.55 : 0.45}
					shapeRendering="crispEdges"
				/>
			)}
		</svg>
	);
}

function Field({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col">
			<span className="text-(--pass-text-muted) text-[8px] uppercase tracking-normal">
				{label}
			</span>
			<span className="font-semibold text-(--pass-text) text-xs leading-tighter">
				{value}
			</span>
		</div>
	);
}

function EditableField({
	label,
	value,
	onChange,
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
}) {
	return (
		<div className="flex flex-col">
			<span className="text-(--pass-text-muted) text-[8px] uppercase tracking-normal">
				{label}
			</span>
			<input
				className="w-24 bg-transparent font-semibold text-(--pass-text) text-xs leading-tighter caret-(--pass-text) outline-none placeholder:text-(--pass-text-subtle)"
				maxLength={24}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				type="text"
				value={value}
			/>
		</div>
	);
}

export function PassPlayground({ qrSlot }: { qrSlot?: ReactNode }) {
	const memberNo = "123456";
	const since = fmtDate(new Date());
	const [name, setName] = useState("");
	const [color, setColor] = useState<ColorValue>("blue");
	const [pattern, setPattern] = useState<PatternType>("waves");

	const activeColor = COLORS.find((c) => c.value === color) ?? COLORS[5];
	const [colorTransition, setColorTransition] = useState(false);
	const cardStyle = {
		backgroundColor: activeColor.color,
		"--pass-text": activeColor.text,
		"--pass-text-muted": activeColor.muted,
		"--pass-text-subtle": activeColor.subtle,
	} as CSSProperties;

	return (
		<div className="flex items-start gap-6">
			{/* Card */}
			<div
				className={cn(
					"relative aspect-181/251 w-[256px] shrink-0 select-none overflow-hidden rounded-lg border-overlay text-(--pass-text)",
					colorTransition && "transition-colors duration-300"
				)}
				style={cardStyle}
			>
				{/* Noise overlay */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 z-10 opacity-10 mix-blend-overlay"
					style={{
						backgroundImage:
							"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
						backgroundSize: "200px 200px",
					}}
				/>
				<div className="flex h-full flex-col">
					<div className="flex items-start justify-between p-3">
						<span className="font-semibold">Passlet</span>
						<div className="flex flex-col items-end">
							<span className="text-(--pass-text-subtle) text-[8px] uppercase tracking-tight">
								No.
							</span>
							<span className="font-medium text-[11px] tabular-nums leading-[1.2]">
								{memberNo}
							</span>
						</div>
					</div>

					<CardStrip pattern={pattern} />

					<div className="flex flex-col gap-1 p-3">
						<div className="flex justify-between">
							<EditableField
								label="Member"
								onChange={setName}
								placeholder="Your Name"
								value={name}
							/>
							<Field label="Since" value={since} />
						</div>
					</div>

					<div className="mt-auto flex justify-center pb-3">
						<div className="size-24 overflow-hidden rounded-sm bg-white">
							{qrSlot}
						</div>
					</div>
				</div>
			</div>

			{/* Controls */}
			<div className="flex flex-col gap-4 pt-1">
				{/* Color */}
				<div className="flex flex-col gap-2">
					<p className="font-medium text-[#707070] text-xs">Background Color</p>
					<div className={cn("flex flex-wrap gap-1.5")}>
						{COLORS.map((c) => {
							const isSelected = color === c.value;
							return (
								<button
									aria-label={`Select ${c.label} color`}
									aria-pressed={isSelected}
									className="relative size-5 cursor-pointer rounded-md transition-transform duration-150 ease-out after:absolute after:-inset-1.5 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 active:scale-95"
									key={c.value}
									onClick={() => {
										setColorTransition(true);
										setColor(c.value);
									}}
									style={{
										backgroundColor: c.color,
										color: c.color,
										...(isSelected && {
											boxShadow: `inset 0 0 0 2px #F5F5F5, 0 0 0 2px ${c.color}`,
										}),
									}}
									title={c.label}
									type="button"
								/>
							);
						})}
					</div>
				</div>

				{/* Pattern */}
				<div className="flex flex-col gap-2">
					<p className="font-medium text-[#707070] text-xs">Pattern</p>
					<div className="flex gap-1.5">
						{PATTERNS.map((p) => {
							const isSelected = pattern === p.value;
							return (
								<button
									aria-label={`Select ${p.label} pattern`}
									aria-pressed={isSelected}
									className="relative cursor-pointer overflow-hidden rounded transition-transform duration-150 ease-out after:absolute after:-inset-1.5 after:content-[''] focus:outline-none active:scale-95"
									key={p.value}
									onClick={() => setPattern(p.value)}
									style={{
										outline: isSelected
											? "2px solid #1E1E1E"
											: "2px solid transparent",
										outlineOffset: 2,
									}}
									title={p.label}
									type="button"
								>
									<PatternSwatch pattern={p.value} selected={isSelected} />
								</button>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
