"use client";

import { useState } from "react";
import {
	PATTERNS,
	PassCard,
	type PassData,
	type PassTheme,
	THEMES,
} from "@/components/pass-card";

const DEFAULT_DATA: PassData = {
	holderName: "Alex Morgan",
	logoText: "Meridian",
	tier: "Gold",
	points: "42,800",
	memberSince: "2021",
	validThrough: "12/27",
};

function PatternThumb({
	pattern,
	theme,
	active,
	onClick,
}: {
	pattern: string;
	theme: PassTheme;
	active: boolean;
	onClick: () => void;
}) {
	const patternBg: Record<string, string> = {
		pinstripe:
			"linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.2) 100%), repeating-linear-gradient(-52deg, transparent 0px, transparent 3px, rgba(255,255,255,0.12) 3px, rgba(255,255,255,0.12) 4px)",
		carbon:
			"linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.25) 100%), repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(255,255,255,0.14) 2px, rgba(255,255,255,0.14) 3px), repeating-linear-gradient(90deg, transparent 0px, transparent 2px, rgba(255,255,255,0.14) 2px, rgba(255,255,255,0.14) 3px)",
		brocade:
			"linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.2) 100%), repeating-linear-gradient(45deg, rgba(255,255,255,0.1) 0px, rgba(255,255,255,0.1) 2px, transparent 2px, transparent 6px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.1) 0px, rgba(255,255,255,0.1) 2px, transparent 2px, transparent 6px)",
		brushed:
			"linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 40%, rgba(255,255,255,0.06) 70%, rgba(0,0,0,0.2) 100%), repeating-linear-gradient(180deg, transparent 0px, transparent 1px, rgba(255,255,255,0.1) 1px, rgba(255,255,255,0.1) 2px)",
	};

	return (
		<button
			onClick={onClick}
			style={{
				width: 44,
				height: 28,
				borderRadius: 6,
				backgroundColor: theme.strip,
				backgroundImage: patternBg[pattern],
				border: active ? "2px solid rgba(0,0,0,0.75)" : "2px solid transparent",
				cursor: "pointer",
				padding: 0,
				outline: "none",
				boxShadow: active
					? "0 0 0 1.5px rgba(255,255,255,0.9), 0 2px 6px rgba(0,0,0,0.2)"
					: "0 1px 3px rgba(0,0,0,0.15)",
				transition: "all 0.15s ease",
			}}
			title={pattern}
			type="button"
		/>
	);
}

function EditableField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
}) {
	const id = `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<label
				htmlFor={id}
				style={{
					fontSize: 10,
					fontWeight: 600,
					letterSpacing: "0.08em",
					textTransform: "uppercase" as const,
					color: "#888",
				}}
			>
				{label}
			</label>
			<input
				id={id}
				onChange={(e) => onChange(e.target.value)}
				style={{
					fontSize: 13,
					fontWeight: 500,
					color: "#111",
					background: "#F0EFEC",
					border: "1px solid rgba(0,0,0,0.09)",
					borderRadius: 8,
					padding: "7px 10px",
					outline: "none",
					fontFamily: "-apple-system, sans-serif",
					width: "100%",
					boxSizing: "border-box" as const,
				}}
				value={value}
			/>
		</div>
	);
}

export default function Home() {
	const [themeId, setThemeId] = useState("azure");
	const [patternId, setPatternId] = useState("pinstripe");
	const [data, setData] = useState<PassData>(DEFAULT_DATA);

	const theme =
		THEMES.find((t) => t.id === themeId) ?? (THEMES[0] as PassTheme);

	function setField<K extends keyof PassData>(key: K, value: PassData[K]) {
		setData((d) => ({ ...d, [key]: value }));
	}

	return (
		<main
			style={{
				minHeight: "100%",
				background: "#EEECEA",
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "center",
				padding: "52px 24px 80px",
				fontFamily:
					"-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif",
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: 32,
					width: "100%",
					maxWidth: 400,
				}}
			>
				{/* Pass preview */}
				<div style={{ position: "relative" }}>
					<div
						style={{
							position: "absolute",
							bottom: -16,
							left: "50%",
							transform: "translateX(-50%)",
							width: 260,
							height: 24,
							borderRadius: 16,
							background: "rgba(0,0,0,0.1)",
							filter: "blur(12px)",
						}}
					/>
					<PassCard data={data} pattern={patternId} theme={theme} />
				</div>

				{/* Controls */}
				<div
					style={{
						width: 320,
						display: "flex",
						flexDirection: "column",
						gap: 10,
					}}
				>
					{/* Swatches + patterns in one row */}
					<div
						style={{
							background: "rgba(255,255,255,0.72)",
							backdropFilter: "blur(16px)",
							WebkitBackdropFilter: "blur(16px)",
							borderRadius: 14,
							padding: "14px 16px",
							boxShadow:
								"0 1px 3px rgba(0,0,0,0.07), 0 0 0 0.5px rgba(0,0,0,0.05)",
						}}
					>
						<div
							style={{
								fontSize: 10,
								fontWeight: 600,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								color: "#999",
								marginBottom: 12,
							}}
						>
							Appearance
						</div>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								flexWrap: "wrap",
							}}
						>
							{/* Color circles */}
							{THEMES.map((t) => (
								<button
									key={t.id}
									onClick={() => setThemeId(t.id)}
									style={{
										width: 22,
										height: 22,
										borderRadius: "50%",
										backgroundColor: t.swatch,
										border:
											themeId === t.id
												? "2px solid #111"
												: "2px solid transparent",
										outline:
											themeId === t.id
												? "2px solid rgba(255,255,255,0.85)"
												: "2px solid transparent",
										outlineOffset: -1,
										cursor: "pointer",
										padding: 0,
										boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
										transform: themeId === t.id ? "scale(1.18)" : "scale(1)",
										transition: "transform 0.12s ease",
									}}
									title={t.id}
									type="button"
								/>
							))}

							<div
								style={{
									width: "0.5px",
									height: 18,
									backgroundColor: "rgba(0,0,0,0.1)",
									marginLeft: 2,
									marginRight: 2,
								}}
							/>

							{/* Pattern thumbnails */}
							{PATTERNS.map((p) => (
								<PatternThumb
									active={patternId === p.id}
									key={p.id}
									onClick={() => setPatternId(p.id)}
									pattern={p.id}
									theme={theme}
								/>
							))}
						</div>
					</div>

					{/* Text fields */}
					<div
						style={{
							background: "rgba(255,255,255,0.72)",
							backdropFilter: "blur(16px)",
							WebkitBackdropFilter: "blur(16px)",
							borderRadius: 14,
							padding: "14px 16px",
							boxShadow:
								"0 1px 3px rgba(0,0,0,0.07), 0 0 0 0.5px rgba(0,0,0,0.05)",
							display: "flex",
							flexDirection: "column",
							gap: 12,
						}}
					>
						<EditableField
							label="Name"
							onChange={(v) => setField("holderName", v)}
							value={data.holderName}
						/>
						<EditableField
							label="Logo Text"
							onChange={(v) => setField("logoText", v)}
							value={data.logoText}
						/>
					</div>

					<p
						style={{
							textAlign: "center",
							fontSize: 11,
							color: "#BBB",
							margin: 0,
							letterSpacing: "0.02em",
							paddingTop: 4,
						}}
					>
						passlet · Apple Wallet pass builder
					</p>
				</div>
			</div>
		</main>
	);
}
