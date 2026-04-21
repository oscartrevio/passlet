"use client";

import { Button } from "@passlet/ui/components/button";
import { cn } from "@passlet/ui/lib/utils";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { createPassAction } from "@/actions/create-pass";
import { setPassletColor } from "@/actions/set-color";
import { AppleWalletIcon, GoogleWalletIcon } from "@/components/wallet-icons";
import {
	COLORS,
	type ColorValue,
	PATTERNS,
	type PatternType,
} from "@/lib/data";
import {
	captureBannerBytes,
	STRIP_H,
	STRIP_PATHS,
	STRIP_W,
	STROKE_PATTERNS,
	STROKE_WIDTH,
	SWATCH_H,
	SWATCH_PATHS,
	SWATCH_W,
} from "@/lib/patterns";
import type { WalletProvider } from "@/types/pass";

const TODAY = new Date().toLocaleDateString("en-US", {
	year: "numeric",
	month: "long",
	day: "numeric",
});

function CardStrip({ pattern }: { pattern: PatternType }) {
	return (
		<svg
			aria-hidden="true"
			className="pointer-events-none w-full"
			fill="none"
			overflow="visible"
			style={{ color: "var(--pass-secondary)" }}
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
			</defs>
			{STROKE_PATTERNS.has(pattern) ? (
				<path
					clipPath="url(#strip-clip)"
					d={STRIP_PATHS[pattern]}
					fill="none"
					stroke="currentColor"
					strokeOpacity={0.5}
					strokeWidth={STROKE_WIDTH}
				/>
			) : (
				<path
					clipPath="url(#strip-clip)"
					d={STRIP_PATHS[pattern]}
					fill="currentColor"
					fillOpacity={0.5}
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

export function PassPlayground({
	memberNo,
	initialColor = "blue",
	qrSlot,
}: {
	memberNo: string;
	initialColor?: ColorValue;
	qrSlot?: ReactNode;
}) {
	const [name, setName] = useState("");
	const [color, setColor] = useState<ColorValue>(initialColor);
	const [pattern, setPattern] = useState<PatternType>("waves");
	const [provider, setProvider] = useState<WalletProvider>("apple");
	const [creating, setCreating] = useState(false);
	const [wiggleName, setWiggleName] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const shouldReduceMotion = useReducedMotion();
	const colorDelightControls = useAnimationControls();

	const activeColor = COLORS.find((c) => c.value === color) ?? COLORS[5];

	const handleColorChange = (value: ColorValue) => {
		if (value === color) {
			return;
		}
		setColor(value);
		if (!shouldReduceMotion) {
			colorDelightControls
				.start({
					y: [0, -1, 0],
					scale: [1, 1.008, 1],
					transition: {
						duration: 0.25,
						ease: "easeInOut",
					},
				})
				.catch(() => undefined);
		}
		setPassletColor(value).catch(() => {
			setCreateError("Unable to save your color preference.");
		});
	};

	const cardStyle = {
		backgroundColor: activeColor.color,
		"--pass-text": activeColor.text,
		"--pass-text-muted": activeColor.muted,
		"--pass-text-subtle": activeColor.subtle,
		"--pass-secondary": activeColor.secondary,
	} as CSSProperties;

	const handleCreatePass = async () => {
		if (creating) {
			return;
		}
		const trimmedName = name.trim();
		if (!trimmedName) {
			setWiggleName(true);
			setTimeout(() => setWiggleName(false), 300);
			return;
		}
		setCreateError(null);
		setCreating(true);
		try {
			const banner =
				provider === "apple" ? await captureBannerBytes(pattern) : undefined;
			const [result] = await Promise.all([
				createPassAction({
					provider,
					memberName: trimmedName,
					memberNo,
					since: TODAY,
					color: activeColor.color,
					textColor: activeColor.text,
					banner,
				}),
				new Promise<void>((resolve) => setTimeout(resolve, 400)),
			]);
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
		} catch (error) {
			setCreateError(
				error instanceof Error ? error.message : "Failed to create pass."
			);
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="flex w-full flex-col gap-6">
			<div className="flex justify-center">
				<div className="w-full max-w-[320px] lg:max-w-[420px]">
					<motion.div
						animate={colorDelightControls}
						className="relative aspect-181/251 w-full select-none overflow-hidden rounded-lg border-overlay text-(--pass-text) transition-colors duration-[250ms]"
						initial={false}
						style={cardStyle}
					>
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
					</motion.div>
				</div>
			</div>

			<div className="flex flex-col gap-4 pt-1 lg:mx-auto lg:w-full lg:max-w-[360px]">
				<div className="flex gap-6">
					<div className="flex flex-col gap-2">
						<p className="font-medium text-(--gray-a8) text-xs">
							Background Color
						</p>
						<div className="flex flex-wrap gap-1.5">
							{COLORS.map((c) => {
								const isSelected = color === c.value;
								return (
									<button
										aria-label={`Select ${c.label} color`}
										aria-pressed={isSelected}
										className="relative size-5 cursor-pointer rounded-sm border-overlay transition-transform duration-150 ease-out after:absolute after:-inset-1.5 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 active:scale-95"
										key={c.value}
										onClick={() => handleColorChange(c.value)}
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
						<p className="font-medium text-(--gray-a8) text-xs">Pattern</p>
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
				</div>

				<div className="flex flex-col gap-2">
					<p className="font-medium text-(--gray-a8) text-xs">
						Wallet Provider
					</p>
					<div className="flex gap-1.5">
						<button
							aria-label="Select Apple Wallet"
							aria-pressed={provider === "apple"}
							className={cn(
								"flex h-7 w-12 cursor-pointer items-center justify-center rounded-md border-shadow transition-all duration-150 ease-out focus:outline-none active:scale-95",
								provider === "apple"
									? "bg-(--gray-a12)"
									: "bg-transparent hover:bg-(--gray-a4)"
							)}
							onClick={() => setProvider("apple")}
							type="button"
						>
							<AppleWalletIcon
								className={
									provider === "apple" ? "text-white" : "text-(--gray-a12)"
								}
							/>
						</button>

						<button
							aria-label="Select Google Wallet"
							aria-pressed={provider === "google"}
							className={cn(
								"flex h-7 w-12 cursor-pointer items-center justify-center rounded-md border-shadow transition-all duration-150 ease-out focus:outline-none active:scale-95",
								provider === "google"
									? "bg-(--gray-a12)"
									: "bg-transparent hover:bg-(--gray-a4)"
							)}
							onClick={() => setProvider("google")}
							type="button"
						>
							<GoogleWalletIcon
								className={
									provider === "google" ? "text-white" : "text-(--gray-a12)"
								}
							/>
						</button>
					</div>
				</div>

				{createError ? (
					<p className="text-(--red-a11) text-xs leading-normal">
						{createError}
					</p>
				) : null}

				<Button
					className="rounded-full bg-(--gray-a12) font-medium font-sans! text-white tracking-tight hover:bg-(--gray-a11) active:scale-95"
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
					<span>{creating ? "Adding..." : "Add to Wallet"}</span>
				</Button>
			</div>
		</div>
	);
}
