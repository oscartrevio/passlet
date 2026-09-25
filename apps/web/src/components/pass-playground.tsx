"use client";

import { Button } from "@passlet/ui/components/button";
import { cn } from "@passlet/ui/lib/utils";
import type { SoundPatch } from "@web-kits/audio";
import { usePatch } from "@web-kits/audio/react";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import { createPassAction } from "@/actions/create-pass";
import { setPassletColor } from "@/actions/set-color";
import { usePassEasterEgg } from "@/components/use-pass-easter-egg";
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
import minimalPatch from "../../.web-kits/minimal.json";

const TODAY = new Date().toLocaleDateString("en-US", {
	year: "numeric",
	month: "long",
	day: "numeric",
});

// Both sides of the pass share one box; the back is pre-rotated so the flip
// reveals it, and each side hides when it faces away. The shadow lives on the
// faces (not the wrapper) so it turns with the card and hides with its side.
const PASS_FACE =
	"absolute inset-0 flex flex-col overflow-hidden rounded-lg border-overlay soft-shadow hover:hover-soft-shadow bg-(--pass-bg) text-(--pass-text) transition-[color,background-color,box-shadow] duration-250 backface-hidden";

type CreateStatus =
	| { kind: "idle" }
	| { kind: "creating" }
	| { kind: "created"; provider: WalletProvider }
	| { kind: "failed"; message: string };

function createButtonLabel(status: CreateStatus): string {
	switch (status.kind) {
		case "creating":
			return "Adding...";
		case "created":
			return status.provider === "apple"
				? "Pass Downloaded"
				: "Opened in Google Wallet";
		default:
			return "Add to Wallet";
	}
}

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

// The back of the pass: the wordmark pressed into the card. The letters are
// shaded darker at the top and lighter at the bottom, like a recess catching
// light from above; a dark hairline on the top edge and a light lip on the
// bottom edge sell the depth. A soft light across the card keeps the surface
// from reading as flat paint.
function PassBack() {
	return (
		<>
			<div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_25%_0%,rgb(255_255_255/0.12),transparent_65%)]" />
			<span className="absolute inset-0 grid place-items-center">
				<span className="bg-[linear-gradient(180deg,color-mix(in_oklab,var(--pass-bg),black_16%),color-mix(in_oklab,var(--pass-bg),black_4%))] bg-clip-text font-semibold text-[52px] text-transparent tracking-tighter [filter:drop-shadow(0_-0.5px_0_rgb(0_0_0/0.3))_drop-shadow(0_1px_0_rgb(255_255_255/0.3))]">
					Passlet
				</span>
			</span>
		</>
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
					"w-24 cursor-text bg-transparent font-semibold text-(--pass-text) text-xs leading-tighter caret-(--pass-text) outline-none transition-colors duration-300 placeholder:text-(--pass-text-subtle) placeholder:transition-colors placeholder:duration-300",
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
	const [status, setStatus] = useState<CreateStatus>({ kind: "idle" });
	const [wiggleName, setWiggleName] = useState(false);
	const creating = status.kind === "creating";
	const created = status.kind === "created";
	const createdTimeoutRef = useRef<number>(undefined);
	const shouldReduceMotion = useReducedMotion();
	const delightControls = useAnimationControls();

	const sounds = usePatch(minimalPatch as SoundPatch);

	const playSound = (soundName: string) => {
		if (sounds.ready) {
			sounds.play(soundName);
		}
	};

	const activeColor = COLORS.find((c) => c.value === color) ?? COLORS[5];

	const triggerDelight = () => {
		if (shouldReduceMotion) {
			return;
		}
		delightControls
			.start({
				y: [0, -1, 0],
				scale: [1, 1.008, 1],
				transition: {
					duration: 0.25,
					ease: "easeInOut",
				},
			})
			.catch(() => undefined);
	};

	const handleColorChange = (value: ColorValue) => {
		if (value === color) {
			return;
		}
		setColor(value);
		playSound("select");
		triggerDelight();
		setPassletColor(value).catch(() => {
			setStatus({
				kind: "failed",
				message: "Unable to save your color preference.",
			});
		});
	};

	const handlePatternChange = (value: PatternType) => {
		if (value === pattern) {
			return;
		}
		setPattern(value);
		playSound("tap");
		triggerDelight();
	};

	const handleProviderChange = (value: WalletProvider) => {
		if (value === provider) {
			return;
		}
		setProvider(value);
		playSound("tap");
	};

	const { flip, flipped, handleTap } = usePassEasterEgg({
		wobble: delightControls,
		playSound,
	});

	const cardStyle = {
		"--pass-bg": activeColor.color,
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
			playSound("error");
			setWiggleName(true);
			setTimeout(() => setWiggleName(false), 300);
			return;
		}
		clearTimeout(createdTimeoutRef.current);
		setStatus({ kind: "creating" });
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
			setStatus({ kind: "created", provider });
			createdTimeoutRef.current = window.setTimeout(
				() => setStatus({ kind: "idle" }),
				2500
			);
			playSound("success");
		} catch (error) {
			setStatus({
				kind: "failed",
				message:
					error instanceof Error ? error.message : "Failed to create pass.",
			});
			playSound("error");
		}
	};

	return (
		<div className="flex flex-col gap-5 md:flex-row md:items-stretch md:gap-4">
			<motion.div
				animate={delightControls}
				className="relative mx-auto aspect-181/251 w-full max-w-[256px] cursor-pointer select-none motion-reduce:cursor-auto md:mx-0 md:w-[256px]"
				initial={false}
				onClick={handleTap}
				style={{ ...cardStyle, transformPerspective: 800 }}
			>
				<motion.div
					animate={flip}
					className="transform-3d size-full"
					initial={false}
					style={{ transformPerspective: 1200 }}
				>
					<div className={PASS_FACE} inert={flipped}>
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

					<div className={cn(PASS_FACE, "rotate-y-180")} inert={!flipped}>
						<PassBack />
					</div>
				</motion.div>
			</motion.div>

			<div className="flex min-w-0 flex-1 flex-col gap-4">
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
									onClick={() => handlePatternChange(p.value)}
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
							onClick={() => handleProviderChange("apple")}
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
							onClick={() => handleProviderChange("google")}
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

				{status.kind === "failed" ? (
					<p className="text-(--red-a11) text-xs leading-normal" role="alert">
						{status.message}
					</p>
				) : null}

				<Button
					aria-busy={creating}
					// Stays clickable while announced as disabled, so an empty-name
					// click can still answer with the error sound and field wiggle.
					aria-disabled={creating || !name.trim()}
					className="mt-auto font-sans! tracking-tight"
					onClick={handleCreatePass}
				>
					<span className="relative size-4">
						<span
							className={cn(
								"absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-in-out will-change-[opacity,filter,scale]",
								created
									? "scale-100 opacity-100 blur-0"
									: "scale-[0.25] opacity-0 blur-sm"
							)}
						>
							<svg
								aria-hidden="true"
								fill="currentColor"
								height="16"
								viewBox="0 0 640 640"
								width="16"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path d="M320 576C178.6 576 64 461.4 64 320C64 178.6 178.6 64 320 64C461.4 64 576 178.6 576 320C576 461.4 461.4 576 320 576zM438 209.7C427.3 201.9 412.3 204.3 404.5 215L285.1 379.2L233 327.1C223.6 317.7 208.4 317.7 199.1 327.1C189.8 336.5 189.7 351.7 199.1 361L271.1 433C276.1 438 282.9 440.5 289.9 440C296.9 439.5 303.3 435.9 307.4 430.2L443.3 243.2C451.1 232.5 448.7 217.5 438 209.7z" />
							</svg>
						</span>
						<span
							className={cn(
								"absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-in-out will-change-[opacity,filter,scale]",
								created
									? "scale-[0.25] opacity-0 blur-sm"
									: "scale-100 opacity-100 blur-0"
							)}
						>
							<svg
								aria-hidden="true"
								fill="currentColor"
								height="16"
								viewBox="0 0 640 640"
								width="16"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path d="M128 96C92.7 96 64 124.7 64 160L64 448C64 483.3 92.7 512 128 512L512 512C547.3 512 576 483.3 576 448L576 256C576 220.7 547.3 192 512 192L136 192C122.7 192 112 181.3 112 168C112 154.7 122.7 144 136 144L520 144C533.3 144 544 133.3 544 120C544 106.7 533.3 96 520 96L128 96zM480 320C497.7 320 512 334.3 512 352C512 369.7 497.7 384 480 384C462.3 384 448 369.7 448 352C448 334.3 462.3 320 480 320z" />
							</svg>
						</span>
					</span>
					<span aria-live="polite">{createButtonLabel(status)}</span>
				</Button>
			</div>
		</div>
	);
}
