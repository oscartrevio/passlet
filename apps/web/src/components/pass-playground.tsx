"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

/* ─── Types ───────────────────────────────────────────────── */
type Pattern = "none" | "dots" | "lines" | "grid";

/* ─── Config ──────────────────────────────────────────────── */
const COLORS = [
	{ label: "Green", hex: "#22C55E" },
	{ label: "Amber", hex: "#F59E0B" },
	{ label: "Orange", hex: "#F97316" },
	{ label: "Red", hex: "#EF4444" },
	{ label: "Purple", hex: "#A855F7" },
	{ label: "Blue", hex: "#3B82F6" },
] as const;

const PATTERNS: Pattern[] = ["none", "dots", "lines", "grid"];

const PLACEHOLDERS = [
	"Michael Scott",
	"Walter White",
	"Tony Soprano",
	"Saul Goodman",
	"Don Draper",
	"Leslie Knope",
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

/* ─── Helpers ─────────────────────────────────────────────── */
function fmtDate(d: Date) {
	return `${MONTHS[d.getMonth()]}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function getCookie(name: string): string | null {
	if (typeof document === "undefined") {
		return null;
	}
	const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
	return m ? decodeURIComponent(m[1]) : null;
}

function saveCookie(name: string, value: string) {
	const exp = new Date();
	exp.setFullYear(exp.getFullYear() + 1);
	// biome-ignore lint/suspicious/noDocumentCookie: direct cookie assignment is intentional here
	document.cookie = `${name}=${encodeURIComponent(value)};expires=${exp.toUTCString()};path=/;SameSite=Lax`;
}

function randNo(): string {
	return String(Math.floor(100_000 + Math.random() * 900_000));
}

/* ─── QR Code (visual placeholder) ───────────────────────── */
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

/* ─── Pattern overlay ─────────────────────────────────────── */
function getPatternStyle(pattern: Pattern): CSSProperties {
	switch (pattern) {
		case "dots":
			return {
				backgroundImage:
					"radial-gradient(circle, rgba(255,255,255,0.22) 1.2px, transparent 1.2px)",
				backgroundSize: "10px 10px",
			};
		case "lines":
			return {
				backgroundImage:
					"repeating-linear-gradient(-45deg, rgba(255,255,255,0.12), rgba(255,255,255,0.12) 1px, transparent 1px, transparent 9px)",
			};
		case "grid":
			return {
				backgroundImage:
					"linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)",
				backgroundSize: "14px 14px",
			};
		default:
			return {};
	}
}

/* ─── Pattern swatch icons ────────────────────────────────── */
function PatternSwatch({
	type,
	selected,
}: {
	type: Pattern;
	selected: boolean;
}) {
	const fill = selected ? "#444" : "#C0C0C0";
	return (
		<svg
			aria-hidden="true"
			height={26}
			style={{ display: "block" }}
			viewBox="0 0 26 26"
			width={26}
		>
			<rect fill={fill} height={26} rx={5} width={26} />
			{type === "dots" &&
				[5, 13, 21].flatMap((x) =>
					[5, 13, 21].map((y) => (
						<circle
							cx={x}
							cy={y}
							fill="white"
							key={`${x}-${y}`}
							opacity={0.7}
							r={2}
						/>
					))
				)}
			{type === "lines" &&
				[-2, 7, 16, 25].map((offset) => (
					<line
						key={offset}
						stroke="white"
						strokeOpacity={0.55}
						strokeWidth={1.5}
						x1={offset - 8}
						x2={offset + 8}
						y1={-4}
						y2={30}
					/>
				))}
			{type === "grid" && (
				<>
					{[9, 17].map((x) => (
						<line
							key={`v${x}`}
							stroke="white"
							strokeOpacity={0.5}
							strokeWidth={1}
							x1={x}
							x2={x}
							y1={2}
							y2={24}
						/>
					))}
					{[9, 17].map((y) => (
						<line
							key={`h${y}`}
							stroke="white"
							strokeOpacity={0.5}
							strokeWidth={1}
							x1={2}
							x2={24}
							y1={y}
							y2={y}
						/>
					))}
				</>
			)}
		</svg>
	);
}

/* ─── Card field ──────────────────────────────────────────── */
function Field({
	label,
	value,
	dim,
}: {
	label: string;
	value: string;
	dim?: boolean;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<span
				style={{
					fontSize: 8,
					letterSpacing: "0.09em",
					color: "rgba(255,255,255,0.5)",
					textTransform: "uppercase",
				}}
			>
				{label}
			</span>
			<span
				style={{
					fontSize: 13,
					fontWeight: 600,
					color: dim ? "rgba(255,255,255,0.4)" : "white",
					lineHeight: 1.25,
					transition: "color 0.2s ease",
				}}
			>
				{value}
			</span>
		</div>
	);
}

/* ─── Wallet Card ─────────────────────────────────────────── */
interface CardProps {
	color: string;
	memberNo: string;
	name: string;
	pattern: Pattern;
	placeholder: string;
	since: string;
}

function WalletCard({
	name,
	placeholder,
	color,
	pattern,
	memberNo,
	since,
}: CardProps) {
	const displayName = name || placeholder;
	const isDim = !name;

	return (
		<div
			className="relative flex-shrink-0 select-none overflow-hidden"
			style={{
				width: 210,
				height: 328,
				borderRadius: 22,
				backgroundColor: color,
				boxShadow:
					"0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.15)",
				transition: "background-color 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
			}}
		>
			{/* Inner highlight */}
			<div
				className="pointer-events-none absolute inset-0"
				style={{
					background:
						"linear-gradient(140deg, rgba(255,255,255,0.14) 0%, transparent 55%)",
					borderRadius: 22,
				}}
			/>

			{/* Pattern overlay */}
			{pattern !== "none" && (
				<div
					className="pointer-events-none absolute inset-0"
					style={getPatternStyle(pattern)}
				/>
			)}

			{/* Content */}
			<div
				className="relative flex h-full flex-col"
				style={{ padding: "18px 20px 16px" }}
			>
				{/* Header */}
				<div className="flex items-start justify-between">
					<span
						style={{
							fontWeight: 700,
							fontSize: 15,
							color: "white",
							letterSpacing: "-0.02em",
						}}
					>
						Passlet
					</span>
					<div className="flex flex-col items-end">
						<span
							style={{
								fontSize: 7.5,
								letterSpacing: "0.1em",
								color: "rgba(255,255,255,0.5)",
								textTransform: "uppercase",
							}}
						>
							No.
						</span>
						<span
							style={{
								fontWeight: 500,
								fontSize: 11,
								color: "white",
								fontVariantNumeric: "tabular-nums",
								lineHeight: 1.2,
							}}
						>
							{memberNo}
						</span>
					</div>
				</div>

				{/* Fields */}
				<div className="mt-auto flex flex-col gap-3">
					<div className="flex gap-5">
						<Field dim={isDim} label="Member" value={displayName} />
						<Field label="Role" value="Early Adopter" />
					</div>
					<Field label="Since" value={since} />
				</div>

				{/* QR code */}
				<div className="mt-4 flex justify-center">
					<div
						style={{
							background: "rgba(255,255,255,0.96)",
							borderRadius: 10,
							padding: 7,
						}}
					>
						<QRPlaceholder size={74} />
					</div>
				</div>
			</div>
		</div>
	);
}

/* ─── Main component ──────────────────────────────────────── */
export function PassPlayground() {
	const [name, setName] = useState("");
	const [color, setColor] = useState(COLORS[5].hex);
	const [pattern, setPattern] = useState<Pattern>("none");
	const [memberNo, setMemberNo] = useState("------");
	const [placeholder, setPlaceholder] = useState(PLACEHOLDERS[0]);
	const since = fmtDate(new Date());

	useEffect(() => {
		setPlaceholder(
			PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]
		);
		const saved = getCookie("passlet_no");
		setMemberNo(saved ?? randNo());
	}, []);

	function persist(currentNo: string) {
		if (!getCookie("passlet_no")) {
			saveCookie("passlet_no", currentNo);
		}
	}

	return (
		<div className="flex gap-6">
			<WalletCard
				color={color}
				memberNo={memberNo}
				name={name}
				pattern={pattern}
				placeholder={placeholder}
				since={since}
			/>

			<div className="flex flex-1 flex-col gap-5 pt-1">
				{/* Name */}
				<div className="flex flex-col gap-1.5">
					<label className="text-[#707070] text-xs" htmlFor="pass-name">
						Name
					</label>
					<input
						autoComplete="off"
						className="w-full rounded-lg bg-white px-3 py-2 text-[#1E1E1E] outline-none transition-shadow placeholder:text-[#C8C8C8] focus:ring-2 focus:ring-blue-500/20"
						id="pass-name"
						maxLength={28}
						onChange={(e) => {
							setName(e.target.value);
							persist(memberNo);
						}}
						placeholder={placeholder}
						style={{
							fontSize: 16,
							boxShadow: "#0000000F 0px 0px 0px 1px, #00000008 0px 1px 2px",
						}}
						type="text"
						value={name}
					/>
				</div>

				{/* Color */}
				<div className="flex flex-col gap-2">
					<span className="text-[#707070] text-xs">Background Color</span>
					<div className="flex flex-wrap gap-1.5">
						{COLORS.map((c) => (
							<button
								aria-label={`${c.label} color`}
								className="cursor-pointer touch-manipulation"
								key={c.hex}
								onClick={() => {
									setColor(c.hex);
									persist(memberNo);
								}}
								style={{
									width: 36,
									height: 36,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
								}}
								type="button"
							>
								<span
									className="block rounded-full"
									style={{
										width: 22,
										height: 22,
										backgroundColor: c.hex,
										boxShadow:
											color === c.hex
												? `0 0 0 2px white, 0 0 0 3.5px ${c.hex}`
												: "0 0 0 1.5px rgba(0,0,0,0.08)",
										transition: "box-shadow 0.15s ease",
									}}
								/>
							</button>
						))}
					</div>
				</div>

				{/* Pattern */}
				<div className="flex flex-col gap-2">
					<span className="text-[#707070] text-xs">Pattern</span>
					<div className="flex gap-1.5">
						{PATTERNS.map((p) => (
							<button
								aria-label={`${p === "none" ? "No" : p} pattern`}
								className="cursor-pointer touch-manipulation"
								key={p}
								onClick={() => {
									setPattern(p);
									persist(memberNo);
								}}
								style={{
									width: 44,
									height: 44,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									borderRadius: 8,
									outline:
										pattern === p
											? "2px solid #1E1E1E"
											: "2px solid transparent",
									outlineOffset: 2,
									transition: "outline-color 0.15s ease",
								}}
								type="button"
							>
								<PatternSwatch selected={pattern === p} type={p} />
							</button>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
