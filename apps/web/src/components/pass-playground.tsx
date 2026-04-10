"use client";

import { cn } from "@passlet/ui/lib/utils";
import { useState } from "react";

/* ─── Colors ──────────────────────────────────────────────── */
const COLORS = [
	{ label: "Sand", value: "sand", color: "#E8E1D5" },
	{ label: "Green", value: "green", color: "#22C55E" },
	{ label: "Amber", value: "amber", color: "#F59E0B" },
	{ label: "Orange", value: "orange", color: "#F97316" },
	{ label: "Red", value: "red", color: "#EF4444" },
	{ label: "Purple", value: "purple", color: "#A855F7" },
	{ label: "Blue", value: "blue", color: "#3B82F6" },
	{ label: "Midnight", value: "midnight", color: "#1C1C1E" },
] as const;

type ColorValue = (typeof COLORS)[number]["value"];

/* ─── Patterns ────────────────────────────────────────────── */
type PatternType = "waves" | "chessboard";

const PATTERNS: { value: PatternType; label: string }[] = [
	{ value: "waves", label: "Waves" },
	{ value: "chessboard", label: "Chess" },
];

/* ─── Date ────────────────────────────────────────────────── */
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

/* ─── QR Code ─────────────────────────────────────────────── */
function buildQRMatrix(): boolean[][] {
	const N = 21;
	const m: boolean[][] = Array.from({ length: N }, () =>
		new Array(N).fill(false)
	);
	const fp = [
		[1, 1, 1, 1, 1, 1, 1],
		[1, 0, 0, 0, 0, 0, 1],
		[1, 0, 1, 1, 1, 0, 1],
		[1, 0, 1, 1, 1, 0, 1],
		[1, 0, 1, 1, 1, 0, 1],
		[1, 0, 0, 0, 0, 0, 1],
		[1, 1, 1, 1, 1, 1, 1],
	];
	const place = (ro: number, co: number) => {
		for (let r = 0; r < 7; r++) {
			for (let c = 0; c < 7; c++) {
				m[ro + r][co + c] = fp[r][c] === 1;
			}
		}
	};
	place(0, 0);
	place(0, 14);
	place(14, 0);
	for (let i = 8; i <= 12; i++) {
		m[6][i] = i % 2 === 0;
		m[i][6] = i % 2 === 0;
	}
	const res = new Set<string>();
	for (let r = 0; r <= 8; r++) {
		for (let c = 0; c <= 8; c++) {
			res.add(`${r},${c}`);
		}
	}
	for (let r = 0; r <= 8; r++) {
		for (let c = 13; c <= 20; c++) {
			res.add(`${r},${c}`);
		}
	}
	for (let r = 13; r <= 20; r++) {
		for (let c = 0; c <= 8; c++) {
			res.add(`${r},${c}`);
		}
	}
	for (let i = 0; i < N; i++) {
		res.add(`6,${i}`);
		res.add(`${i},6`);
	}
	for (let r = 0; r < N; r++) {
		for (let c = 0; c < N; c++) {
			if (!res.has(`${r},${c}`)) {
				m[r][c] = (r * 17 + c * 13 + r * c * 3) % 10 < 4;
			}
		}
	}
	return m;
}
const QR_MATRIX = buildQRMatrix();

function QRPlaceholder({ size = 76 }: { size?: number }) {
	const cell = size / 21;
	return (
		<svg height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
			<title>QR Code</title>
			<rect fill="white" height={size} width={size} />
			{QR_MATRIX.flatMap((row, r) =>
				row.map((on, c) =>
					on ? (
						<rect
							fill="#111"
							height={cell}
							key={`${r}-${c}`}
							width={cell}
							x={c * cell}
							y={r * cell}
						/>
					) : null
				)
			)}
		</svg>
	);
}

/* ─── Pattern path generators ─────────────────────────────── */

// Waves renders as stroke — returns centerline paths only
const WAVE_STROKE = 10;

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
	// Snap square size so tiles fit exactly in both dimensions
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

/* ─── Precomputed paths ───────────────────────────────────── */
const STRIP_W = 256;
const STRIP_H = 104;

const STRIP_PATHS: Record<PatternType, string> = {
	waves: buildWaves(STRIP_W, STRIP_H),
	chessboard: buildChessboard(STRIP_W, STRIP_H),
};

const SWATCH_W = 30;
const SWATCH_H = 22;

const SWATCH_PATHS: Record<PatternType, string> = {
	waves: buildWaves(SWATCH_W, SWATCH_H),
	chessboard: buildChessboard(SWATCH_W, SWATCH_H),
};

/* ─── Card strip ──────────────────────────────────────────── */
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
			{pattern === "waves" ? (
				<path
					d={STRIP_PATHS[pattern]}
					fill="none"
					filter="url(#strip-filter)"
					stroke="white"
					strokeOpacity={0.01}
					strokeWidth={WAVE_STROKE}
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

/* ─── Pattern swatch ──────────────────────────────────────── */
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
			{pattern === "waves" ? (
				<path
					d={SWATCH_PATHS[pattern]}
					fill="none"
					stroke="white"
					strokeOpacity={selected ? 0.55 : 0.45}
					strokeWidth={WAVE_STROKE}
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

/* ─── Card field ──────────────────────────────────────────── */
function Field({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col">
			<span className="text-[8px] text-white/80 uppercase tracking-normal">
				{label}
			</span>
			<span className="font-semibold text-white text-xs leading-tighter">
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
			<span className="text-[8px] text-white/80 uppercase tracking-normal">
				{label}
			</span>
			<input
				className="w-24 bg-transparent font-semibold text-white text-xs leading-tighter caret-white outline-none placeholder:text-white/40"
				maxLength={24}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				type="text"
				value={value}
			/>
		</div>
	);
}

/* ─── Playground ──────────────────────────────────────────── */
export function PassPlayground() {
	const memberNo = "123456";
	const since = fmtDate(new Date());
	const [name, setName] = useState("");
	const [color, setColor] = useState<ColorValue>("blue");
	const [pattern, setPattern] = useState<PatternType>("waves");

	const activeColor = COLORS.find((c) => c.value === color)?.color ?? "#3B82F6";

	return (
		<div className="flex items-start gap-6">
			{/* Card */}
			<div
				className="relative aspect-181/251 w-[256px] shrink-0 select-none overflow-hidden rounded-lg transition-colors duration-300"
				style={{ backgroundColor: activeColor }}
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
						<span className="font-semibold text-white">Passlet</span>
						<div className="flex flex-col items-end">
							<span className="text-[8px] text-white/50 uppercase tracking-tight">
								No.
							</span>
							<span className="font-medium text-[11px] text-white tabular-nums leading-[1.2]">
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
						<div className="rounded-sm bg-white p-2">
							<QRPlaceholder size={72} />
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
