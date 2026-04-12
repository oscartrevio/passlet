"use client";

import { Button } from "@passlet/ui/components/button";
import { cn } from "@passlet/ui/lib/utils";
import { type CSSProperties, type ReactNode, useState } from "react";
import { createPassAction } from "@/actions/create-pass";

// ─── Types ────────────────────────────────────────────────────

type PatternType = "waves" | "zigzag" | "chessboard" | "dots";
type ColorValue = (typeof COLORS)[number]["value"];

// ─── Data ─────────────────────────────────────────────────────

const COLORS = [
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

const PATTERNS: { value: PatternType; label: string }[] = [
	{ value: "waves", label: "Waves" },
	{ value: "zigzag", label: "Zigzag" },
	{ value: "chessboard", label: "Chess" },
	{ value: "dots", label: "Dots" },
];

// ─── Pattern config ───────────────────────────────────────────

const STROKE_WIDTH = 10;
const DOT_RADIUS = 8;
const STROKE_PATTERNS = new Set<PatternType>(["waves", "zigzag"]);

const STRIP_W = 256;
const STRIP_H = 104;
const SWATCH_W = 30;
const SWATCH_H = 22;

// ─── Date ─────────────────────────────────────────────────────

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
] as const;

function formatDate(date: Date): string {
	return `${MONTHS[date.getMonth()]}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

const TODAY = formatDate(new Date());

// ─── Path builders ────────────────────────────────────────────

function buildWaves(
	W: number,
	H: number,
	opts?: { targetWl?: number; targetSp?: number; amp?: number }
): string {
	const targetWl = opts?.targetWl ?? 35;
	const targetSp = opts?.targetSp ?? 20;
	const amp = opts?.amp ?? 5;
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
			d += ` C${x + hw / 3} ${y - amp} ${x + (2 * hw) / 3} ${y - amp} ${x + hw} ${y}`;
			d += ` C${x + hw + hw / 3} ${y + amp} ${x + hw + (2 * hw) / 3} ${y + amp} ${x + wl} ${y}`;
		}
		parts.push(d);
	}
	return parts.join(" ");
}

function buildZigzag(
	W: number,
	H: number,
	opts?: { targetWl?: number; targetSp?: number; amp?: number }
): string {
	const targetWl = opts?.targetWl ?? 24;
	const targetSp = opts?.targetSp ?? 20;
	const amp = opts?.amp ?? 6;
	const segs = Math.round(W / targetWl);
	const rows = Math.round(H / targetSp);
	const wl = W / segs;
	const sp = H / rows;
	const hw = wl / 2;
	const parts: string[] = [];
	for (let r = 0; r < rows; r++) {
		const y = sp * (r + 0.5) + amp;
		let d = `M${-wl} ${y}`;
		for (let i = -1; i <= segs; i++) {
			const x = i * wl;
			d += ` L${x + hw} ${y - amp} L${x + wl} ${y}`;
		}
		parts.push(d);
	}
	return parts.join(" ");
}

function buildChessboard(
	W: number,
	H: number,
	opts?: { targetSq?: number }
): string {
	const targetSq = opts?.targetSq ?? 20;
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

function buildDots(W: number, H: number, opts?: { targetSp?: number }): string {
	const targetSp = opts?.targetSp ?? 24;
	const cols = Math.round(W / targetSp);
	const rows = Math.round(H / targetSp);
	const spX = W / cols;
	const spY = H / rows;
	const parts: string[] = [];
	for (let row = 0; row < rows; row++) {
		const offsetX = row % 2 === 0 ? 0 : spX / 2;
		const cy = spY * (row + 0.5);
		for (let col = 0; col < cols + 1; col++) {
			const cx = spX * col + offsetX;
			parts.push(
				`M${cx - DOT_RADIUS} ${cy} a${DOT_RADIUS},${DOT_RADIUS} 0 1,0 ${DOT_RADIUS * 2},0 a${DOT_RADIUS},${DOT_RADIUS} 0 1,0 ${-DOT_RADIUS * 2},0`
			);
		}
	}
	return parts.join(" ");
}

// ─── Precomputed paths ────────────────────────────────────────

const STRIP_PATHS: Record<PatternType, string> = {
	waves: buildWaves(STRIP_W, STRIP_H),
	zigzag: buildZigzag(STRIP_W, STRIP_H),
	chessboard: buildChessboard(STRIP_W, STRIP_H),
	dots: buildDots(STRIP_W, STRIP_H),
};

const SWATCH_PATHS: Record<PatternType, string> = {
	waves: buildWaves(SWATCH_W, SWATCH_H, { targetWl: 26, targetSp: 18, amp: 4 }),
	zigzag: buildZigzag(SWATCH_W, SWATCH_H, {
		targetWl: 14,
		targetSp: 16,
		amp: 6,
	}),
	chessboard: buildChessboard(SWATCH_W, SWATCH_H, { targetSq: 10 }),
	dots: buildDots(SWATCH_W, SWATCH_H, { targetSp: 18 }),
};

// ─── Banner capture ───────────────────────────────────────────

// Renders the selected pattern at @2x (750×196) as a transparent PNG,
// replicating the CardStrip SVG filter via canvas compositing:
//   - Outer white glow below the path  (feComposite operator="out")
//   - Dark inset shadow inside the path (feComposite operator="arithmetic" inset)
// Parameters are doubled so visual density matches the card preview at 375pt.
function captureBannerBytes(pattern: PatternType): Promise<string> {
	const W = 750;
	const H = 196;
	const SW = STROKE_WIDTH * 2;

	const pathBuilders: Record<PatternType, () => string> = {
		waves: () => buildWaves(W, H, { targetWl: 70, targetSp: 40, amp: 10 }),
		zigzag: () => buildZigzag(W, H, { targetWl: 48, targetSp: 40, amp: 12 }),
		chessboard: () => buildChessboard(W, H, { targetSq: 40 }),
		dots: () => buildDots(W, H, { targetSp: 48 }),
	};
	const path = new Path2D(pathBuilders[pattern]());
	const isStroke = STROKE_PATTERNS.has(pattern);

	const draw = (ctx: CanvasRenderingContext2D, color: string) => {
		ctx.save();
		if (isStroke) {
			ctx.strokeStyle = color;
			ctx.lineWidth = SW;
			ctx.stroke(path);
		} else {
			ctx.fillStyle = color;
			ctx.fill(path);
		}
		ctx.restore();
	};

	const offscreen = (fn: (ctx: CanvasRenderingContext2D) => void) => {
		const el = document.createElement("canvas");
		el.width = W;
		el.height = H;
		const ctx = el.getContext("2d");
		if (!ctx) {
			throw new Error("Canvas 2D context unavailable.");
		}
		fn(ctx);
		return el;
	};

	// Outer white glow — draw path with shadow, then erase the path shape
	// so only the glow that bleeds outside the path boundary remains.
	const outerGlow = offscreen((ctx) => {
		ctx.shadowColor = "rgba(255,255,255,0.15)";
		ctx.shadowOffsetY = 2;
		ctx.shadowBlur = 2;
		draw(ctx, "white");
		ctx.shadowColor = "transparent";
		ctx.globalCompositeOperation = "destination-out";
		draw(ctx, "white");
	});

	// Dark inset shadow — draw dark path shifted down, then clip it
	// to the interior of the original path shape.
	const insetShadow = offscreen((ctx) => {
		ctx.shadowColor = "rgba(0,0,0,0.15)";
		ctx.shadowOffsetY = -2;
		ctx.shadowBlur = 2;
		draw(ctx, "white");
		ctx.shadowColor = "transparent";
		ctx.globalCompositeOperation = "destination-out";
		draw(ctx, "white");
	});

	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Canvas 2D context unavailable.");
	}
	ctx.drawImage(outerGlow, 0, 0);
	ctx.drawImage(insetShadow, 0, 0);

	outerGlow.width = 0;
	insetShadow.width = 0;

	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			canvas.width = 0;
			if (!blob) {
				reject(new Error("Failed to export banner image."));
				return;
			}
			const reader = new FileReader();
			reader.onload = () => resolve((reader.result as string).split(",")[1]);
			reader.readAsDataURL(blob);
		}, "image/png");
	});
}

// ─── Sub-components ───────────────────────────────────────────

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
				<clipPath id="strip-clip">
					<rect
						height={STRIP_H + STROKE_WIDTH}
						width={STRIP_W}
						x="0"
						y={-STROKE_WIDTH / 2}
					/>
				</clipPath>
				<filter
					colorInterpolationFilters="sRGB"
					filterUnits="userSpaceOnUse"
					height={STRIP_H + 2}
					id="strip-filter"
					width={STRIP_W}
					x="0"
					y="0"
				>
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
					clipPath="url(#strip-clip)"
					d={STRIP_PATHS[pattern]}
					fill="none"
					filter="url(#strip-filter)"
					stroke="white"
					strokeOpacity={0.01}
					strokeWidth={STROKE_WIDTH}
				/>
			) : (
				<path
					clipPath="url(#strip-clip)"
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
					strokeWidth={STROKE_WIDTH}
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
	wiggle,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	wiggle?: boolean;
}) {
	return (
		<div className="flex flex-col">
			<span className="text-(--pass-text-muted) text-[8px] uppercase tracking-normal">
				{label}
			</span>
			<input
				className={cn(
					"w-24 bg-transparent font-semibold text-(--pass-text) text-xs leading-tighter caret-(--pass-text) outline-none placeholder:text-(--pass-text-subtle)",
					value.trim().length === 0 && "animate-pulse",
					wiggle && "animate-[wiggle_0.3s_ease-in-out]"
				)}
				maxLength={24}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				type="text"
				value={value}
			/>
		</div>
	);
}

// ─── Main component ───────────────────────────────────────────

export function PassPlayground({
	memberNo,
	qrSlot,
}: {
	memberNo: string;
	qrSlot?: ReactNode;
}) {
	const [name, setName] = useState("");
	const [color, setColor] = useState<ColorValue>("blue");
	const [pattern, setPattern] = useState<PatternType>("waves");
	const [provider, setProvider] = useState<"apple" | "google">("apple");
	const [creating, setCreating] = useState(false);
	const [wiggleName, setWiggleName] = useState(false);

	const activeColor = COLORS.find((c) => c.value === color) ?? COLORS[5];

	const cardStyle = {
		backgroundColor: activeColor.color,
		"--pass-text": activeColor.text,
		"--pass-text-muted": activeColor.muted,
		"--pass-text-subtle": activeColor.subtle,
	} as CSSProperties;

	const handleCreatePass = async () => {
		if (creating) {
			return;
		}
		if (!name.trim()) {
			setWiggleName(true);
			setTimeout(() => setWiggleName(false), 300);
			return;
		}
		setCreating(true);
		try {
			const banner = await captureBannerBytes(pattern);
			const result = await createPassAction({
				provider,
				memberName: name.trim(),
				memberNo,
				since: TODAY,
				color: activeColor.color,
				textColor: activeColor.text,
				banner,
			});
			if (result.appleBytes) {
				const blob = new Blob([new Uint8Array(result.appleBytes)], {
					type: "application/vnd.apple.pkpass",
				});
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = "pass.pkpass";
				a.click();
				URL.revokeObjectURL(url);
			}
			if (result.googleJwt) {
				const a = document.createElement("a");
				a.href = `https://pay.google.com/gp/v/save/${result.googleJwt}`;
				a.target = "_blank";
				a.rel = "noopener noreferrer";
				a.click();
			}
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="flex items-stretch gap-6">
			{/* Card preview */}
			<div
				className="relative aspect-181/251 w-[256px] shrink-0 select-none overflow-hidden rounded-lg border-overlay text-(--pass-text) transition-colors duration-300"
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
								ID
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
								wiggle={wiggleName}
							/>
							<Field label="Since" value={TODAY} />
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
				<div className="flex flex-col gap-2">
					<p className="font-medium text-[#707070] text-xs">Background Color</p>
					<div className="flex flex-wrap gap-1.5">
						{COLORS.map((c) => {
							const isSelected = color === c.value;
							return (
								<button
									aria-label={`Select ${c.label} color`}
									aria-pressed={isSelected}
									className="relative size-5 cursor-pointer rounded-sm border-overlay transition-transform duration-150 ease-out after:absolute after:-inset-1.5 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 active:scale-95"
									key={c.value}
									onClick={() => setColor(c.value)}
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

				<div className="flex flex-col gap-2">
					<p className="font-medium text-[#707070] text-xs">Pattern</p>
					<div className="flex gap-1.5">
						{PATTERNS.map((p) => {
							const isSelected = pattern === p.value;
							return (
								<button
									aria-label={`Select ${p.label} pattern`}
									aria-pressed={isSelected}
									className="relative cursor-pointer overflow-hidden rounded border-overlay transition-transform duration-150 ease-out after:absolute after:-inset-1.5 after:content-[''] focus:outline-none active:scale-95"
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

				<div className="flex flex-col gap-2">
					<p className="font-medium text-[#707070] text-xs">Wallet Provider</p>
					<div className="flex gap-1.5">
						<button
							aria-label="Select Apple Wallet"
							aria-pressed={provider === "apple"}
							className={cn(
								"flex h-7 w-12 cursor-pointer items-center justify-center rounded-md border-shadow transition-all duration-150 ease-out focus:outline-none active:scale-95",
								provider === "apple"
									? "bg-[#1E1E1E]"
									: "bg-transparent hover:bg-[#F5F5F5]"
							)}
							onClick={() => setProvider("apple")}
							type="button"
						>
							<svg
								aria-hidden="true"
								className={
									provider === "apple" ? "text-white" : "text-[#1E1E1E]"
								}
								fill="currentColor"
								height="20"
								viewBox="0 0 640 640"
								width="20"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path d="M447.1 332.7C446.9 296 463.5 268.3 497.1 247.9C478.3 221 449.9 206.2 412.4 203.3C376.9 200.5 338.1 224 323.9 224C308.9 224 274.5 204.3 247.5 204.3C191.7 205.2 132.4 248.8 132.4 337.5C132.4 363.7 137.2 390.8 146.8 418.7C159.6 455.4 205.8 545.4 254 543.9C279.2 543.3 297 526 329.8 526C361.6 526 378.1 543.9 406.2 543.9C454.8 543.2 496.6 461.4 508.8 424.6C443.6 393.9 447.1 334.6 447.1 332.7zM390.5 168.5C417.8 136.1 415.3 106.6 414.5 96C390.4 97.4 362.5 112.4 346.6 130.9C329.1 150.7 318.8 175.2 321 202.8C347.1 204.8 370.9 191.4 390.5 168.5z" />
							</svg>
						</button>

						<button
							aria-label="Select Google Wallet"
							aria-pressed={provider === "google"}
							className={cn(
								"flex h-7 w-12 cursor-pointer items-center justify-center rounded-md border-shadow transition-all duration-150 ease-out focus:outline-none active:scale-95",
								provider === "google"
									? "bg-[#1E1E1E]"
									: "bg-transparent hover:bg-[#F5F5F5]"
							)}
							onClick={() => setProvider("google")}
							type="button"
						>
							<svg
								aria-hidden="true"
								className={
									provider === "google" ? "text-white" : "text-[#1E1E1E]"
								}
								fill="currentColor"
								height="16"
								viewBox="0 0 640 640"
								width="16"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path d="M564 325.8C564 467.3 467.1 568 324 568C186.8 568 76 457.2 76 320C76 182.8 186.8 72 324 72C390.8 72 447 96.5 490.3 136.9L422.8 201.8C334.5 116.6 170.3 180.6 170.3 320C170.3 406.5 239.4 476.6 324 476.6C422.2 476.6 459 406.2 464.8 369.7L324 369.7L324 284.4L560.1 284.4C562.4 297.1 564 309.3 564 325.8z" />
							</svg>
						</button>
					</div>
				</div>

				<Button
					className="mt-auto rounded-full bg-[#1E1E1E] font-medium text-white hover:bg-[#2E2E2E] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={creating}
					onClick={handleCreatePass}
				>
					<svg
						aria-hidden="true"
						fill="currentColor"
						height="20"
						viewBox="0 0 640 640"
						width="20"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path d="M128 96C92.7 96 64 124.7 64 160L64 448C64 483.3 92.7 512 128 512L512 512C547.3 512 576 483.3 576 448L576 256C576 220.7 547.3 192 512 192L136 192C122.7 192 112 181.3 112 168C112 154.7 122.7 144 136 144L520 144C533.3 144 544 133.3 544 120C544 106.7 533.3 96 520 96L128 96zM480 320C497.7 320 512 334.3 512 352C512 369.7 497.7 384 480 384C462.3 384 448 369.7 448 352C448 334.3 462.3 320 480 320z" />
					</svg>
					Add to Wallet
				</Button>
			</div>
		</div>
	);
}
