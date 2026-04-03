"use client";

import type { CSSProperties } from "react";

export interface PassTheme {
	bg: string;
	id: string;
	label: string;
	strip: string; // darker shade for strip bg
	swatch: string;
	text: string;
}

export interface PassPattern {
	id: string;
	name: string;
}

export interface PassData {
	holderName: string;
	logoText: string;
	memberSince: string;
	points: string;
	tier: string;
	validThrough: string;
}

export const THEMES: PassTheme[] = [
	{
		id: "azure",
		bg: "#0060DF",
		strip: "#0050C0",
		text: "#FFFFFF",
		label: "rgba(255,255,255,0.55)",
		swatch: "#0060DF",
	},
	{
		id: "jet",
		bg: "#141414",
		strip: "#0A0A0A",
		text: "#FFFFFF",
		label: "rgba(255,255,255,0.4)",
		swatch: "#141414",
	},
	{
		id: "crimson",
		bg: "#B01020",
		strip: "#8C0A18",
		text: "#FFFFFF",
		label: "rgba(255,255,255,0.55)",
		swatch: "#B01020",
	},
	{
		id: "forest",
		bg: "#0B5132",
		strip: "#07381F",
		text: "#FFFFFF",
		label: "rgba(255,255,255,0.5)",
		swatch: "#0B5132",
	},
	{
		id: "cognac",
		bg: "#5C2C06",
		strip: "#421F04",
		text: "#F5E6D0",
		label: "rgba(245,230,208,0.55)",
		swatch: "#8B4513",
	},
];

export const PATTERNS: PassPattern[] = [
	{ id: "pinstripe", name: "Stripe" },
	{ id: "carbon", name: "Carbon" },
	{ id: "brocade", name: "Brocade" },
	{ id: "brushed", name: "Brushed" },
];

function getStripStyle(pattern: string, theme: PassTheme): CSSProperties {
	const base: CSSProperties = {
		backgroundColor: theme.strip,
		position: "relative",
	};

	const depth: CSSProperties = {
		...base,
		backgroundBlendMode: "overlay",
	};

	switch (pattern) {
		case "pinstripe":
			return {
				...depth,
				backgroundImage: `
          linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 25%, rgba(255,255,255,0.04) 70%, rgba(0,0,0,0.2) 100%),
          repeating-linear-gradient(
            -52deg,
            transparent 0px, transparent 4px,
            rgba(255,255,255,0.07) 4px, rgba(255,255,255,0.07) 5px
          )
        `,
			};
		case "carbon":
			return {
				...depth,
				backgroundImage: `
          linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 30%, rgba(255,255,255,0.05) 65%, rgba(0,0,0,0.25) 100%),
          repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(255,255,255,0.09) 3px, rgba(255,255,255,0.09) 4px),
          repeating-linear-gradient(90deg, transparent 0px, transparent 3px, rgba(255,255,255,0.09) 3px, rgba(255,255,255,0.09) 4px)
        `,
			};
		case "brocade":
			return {
				...depth,
				backgroundImage: `
          linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 35%, rgba(255,255,255,0.06) 65%, rgba(0,0,0,0.2) 100%),
          repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 2px, transparent 2px, transparent 8px),
          repeating-linear-gradient(-45deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 2px, transparent 2px, transparent 8px)
        `,
			};
		case "brushed":
			return {
				...depth,
				backgroundImage: `
          linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 25%, rgba(255,255,255,0.07) 60%, rgba(0,0,0,0.25) 100%),
          repeating-linear-gradient(
            180deg,
            transparent 0px, transparent 1px,
            rgba(255,255,255,0.055) 1px, rgba(255,255,255,0.055) 2px
          )
        `,
			};
		default:
			return base;
	}
}

// Decorative QR code SVG — static visual for demo
function QRCode({ color }: { color: string }) {
	const fg = color;
	const bg = "transparent";
	const s = 3; // cell size

	// Encoded as row/col pairs of filled cells (simplified QR-like pattern)
	const cells: [number, number][] = [
		// Top-left finder
		[0, 0],
		[0, 1],
		[0, 2],
		[0, 3],
		[0, 4],
		[0, 5],
		[0, 6],
		[1, 0],
		[1, 6],
		[2, 0],
		[2, 2],
		[2, 3],
		[2, 4],
		[2, 6],
		[3, 0],
		[3, 2],
		[3, 3],
		[3, 4],
		[3, 6],
		[4, 0],
		[4, 2],
		[4, 3],
		[4, 4],
		[4, 6],
		[5, 0],
		[5, 6],
		[6, 0],
		[6, 1],
		[6, 2],
		[6, 3],
		[6, 4],
		[6, 5],
		[6, 6],
		// Top-right finder
		[0, 14],
		[0, 15],
		[0, 16],
		[0, 17],
		[0, 18],
		[0, 19],
		[0, 20],
		[1, 14],
		[1, 20],
		[2, 14],
		[2, 16],
		[2, 17],
		[2, 18],
		[2, 20],
		[3, 14],
		[3, 16],
		[3, 17],
		[3, 18],
		[3, 20],
		[4, 14],
		[4, 16],
		[4, 17],
		[4, 18],
		[4, 20],
		[5, 14],
		[5, 20],
		[6, 14],
		[6, 15],
		[6, 16],
		[6, 17],
		[6, 18],
		[6, 19],
		[6, 20],
		// Bottom-left finder
		[14, 0],
		[14, 1],
		[14, 2],
		[14, 3],
		[14, 4],
		[14, 5],
		[14, 6],
		[15, 0],
		[15, 6],
		[16, 0],
		[16, 2],
		[16, 3],
		[16, 4],
		[16, 6],
		[17, 0],
		[17, 2],
		[17, 3],
		[17, 4],
		[17, 6],
		[18, 0],
		[18, 2],
		[18, 3],
		[18, 4],
		[18, 6],
		[19, 0],
		[19, 6],
		[20, 0],
		[20, 1],
		[20, 2],
		[20, 3],
		[20, 4],
		[20, 5],
		[20, 6],
		// Data modules (deterministic pattern)
		[8, 2],
		[8, 4],
		[8, 6],
		[8, 8],
		[8, 10],
		[8, 14],
		[8, 16],
		[8, 18],
		[8, 20],
		[9, 1],
		[9, 3],
		[9, 7],
		[9, 9],
		[9, 11],
		[9, 13],
		[9, 15],
		[9, 17],
		[9, 19],
		[10, 0],
		[10, 2],
		[10, 5],
		[10, 8],
		[10, 10],
		[10, 12],
		[10, 16],
		[10, 18],
		[10, 20],
		[11, 1],
		[11, 4],
		[11, 6],
		[11, 9],
		[11, 13],
		[11, 15],
		[11, 17],
		[11, 19],
		[12, 2],
		[12, 3],
		[12, 7],
		[12, 10],
		[12, 12],
		[12, 14],
		[12, 16],
		[12, 18],
		[13, 1],
		[13, 5],
		[13, 8],
		[13, 11],
		[13, 15],
		[13, 17],
		[13, 19],
	];

	const size = 21 * s;
	return (
		<svg
			aria-hidden="true"
			height={size}
			style={{ display: "block" }}
			viewBox={`0 0 ${size} ${size}`}
			width={size}
		>
			<rect fill={bg} height={size} width={size} />
			{cells.map(([row, col]) => (
				<rect
					fill={fg}
					height={s}
					key={`${row}-${col}`}
					width={s}
					x={col * s}
					y={row * s}
				/>
			))}
		</svg>
	);
}

// Logo mark — abstract geometric shape
function LogoMark({ color }: { color: string }) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="32"
			viewBox="0 0 32 32"
			width="32"
		>
			<rect fill={color} fillOpacity="0.2" height="32" rx="8" width="32" />
			<path
				d="M8 10 L16 6 L24 10 L24 20 L16 26 L8 20 Z"
				fill="none"
				stroke={color}
				strokeWidth="1.5"
			/>
			<circle cx="16" cy="16" fill={color} r="3" />
		</svg>
	);
}

interface PassCardProps {
	data: PassData;
	pattern: string;
	theme: PassTheme;
}

export function PassCard({ theme, pattern, data }: PassCardProps) {
	const stripStyle = getStripStyle(pattern, theme);

	return (
		<div
			style={{
				width: 320,
				borderRadius: 20,
				backgroundColor: theme.bg,
				overflow: "hidden",
				boxShadow:
					"0 24px 60px rgba(0,0,0,0.28), 0 8px 20px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.12)",
				fontFamily:
					"-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif",
				WebkitFontSmoothing: "antialiased",
				userSelect: "none",
				flexShrink: 0,
			}}
		>
			{/* Header row */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "16px 16px 12px",
				}}
			>
				{/* Logo + name */}
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<LogoMark color={theme.text} />
					<span
						style={{
							color: theme.text,
							fontSize: 13,
							fontWeight: 600,
							letterSpacing: "0.02em",
						}}
					>
						{data.logoText}
					</span>
				</div>

				{/* Header field */}
				<div style={{ textAlign: "right" }}>
					<div
						style={{
							color: theme.label,
							fontSize: 9,
							fontWeight: 600,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							marginBottom: 2,
						}}
					>
						Valid Through
					</div>
					<div
						style={{
							color: theme.text,
							fontSize: 15,
							fontWeight: 600,
							letterSpacing: "0.02em",
						}}
					>
						{data.validThrough}
					</div>
				</div>
			</div>

			{/* Strip / banner */}
			<div
				style={{
					...stripStyle,
					height: 130,
					boxShadow:
						"inset 0 6px 16px rgba(0,0,0,0.3), inset 0 -4px 10px rgba(0,0,0,0.15)",
				}}
			/>

			{/* Primary field */}
			<div style={{ padding: "14px 16px 0" }}>
				<div
					style={{
						color: theme.label,
						fontSize: 9,
						fontWeight: 600,
						letterSpacing: "0.1em",
						textTransform: "uppercase",
						marginBottom: 3,
					}}
				>
					Member Name
				</div>
				<div
					style={{
						color: theme.text,
						fontSize: 30,
						fontWeight: 700,
						letterSpacing: "-0.02em",
						lineHeight: 1.1,
					}}
				>
					{data.holderName}
				</div>
			</div>

			{/* Secondary fields */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 1fr 1fr",
					gap: 0,
					padding: "14px 16px 0",
				}}
			>
				{[
					{ label: "Tier", value: data.tier },
					{ label: "Points", value: data.points },
					{ label: "Member Since", value: data.memberSince },
				].map(({ label, value }) => (
					<div key={label}>
						<div
							style={{
								color: theme.label,
								fontSize: 9,
								fontWeight: 600,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								marginBottom: 3,
							}}
						>
							{label}
						</div>
						<div
							style={{
								color: theme.text,
								fontSize: 13,
								fontWeight: 600,
								letterSpacing: "0.01em",
							}}
						>
							{value}
						</div>
					</div>
				))}
			</div>

			{/* Separator */}
			<div
				style={{
					margin: "16px 16px 0",
					height: "0.5px",
					backgroundColor: "rgba(255,255,255,0.15)",
				}}
			/>

			{/* Barcode */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					padding: "16px 16px 20px",
					gap: 10,
				}}
			>
				<div
					style={{
						backgroundColor: "#FFFFFF",
						borderRadius: 8,
						padding: 10,
						boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
					}}
				>
					<QRCode color="#000000" />
				</div>
				<div
					style={{
						color: theme.label,
						fontSize: 9,
						fontWeight: 500,
						letterSpacing: "0.12em",
						textTransform: "uppercase",
					}}
				>
					MERIDIAN · CLUB · MEMBER
				</div>
			</div>
		</div>
	);
}
