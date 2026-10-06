"use client";

import { Separator } from "@passlet/ui/components/separator";
import { cn } from "@passlet/ui/lib/utils";
import { Fragment, useRef, useState } from "react";

type InstallOption = "npm" | "pnpm" | "yarn" | "bun" | "skill";

const COMMANDS: Record<InstallOption, string> = {
	npm: "npm i passlet",
	pnpm: "pnpm i passlet",
	yarn: "yarn add passlet",
	bun: "bun i passlet",
	skill: "npx skills add oscartrevio/passlet",
};

type CopyState = "idle" | "copied" | "failed";

const COPY_ANNOUNCEMENTS: Record<CopyState, string> = {
	idle: "",
	copied: "Install command copied",
	failed: "Couldn't copy. Select the command and copy it manually.",
};

export function InstallCommand() {
	const [pm, setPm] = useState<InstallOption>("npm");
	const [copyState, setCopyState] = useState<CopyState>("idle");
	const copied = copyState === "copied";
	const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const copy = () => {
		clearTimeout(timeoutRef.current);
		navigator.clipboard.writeText(COMMANDS[pm]).then(
			() => setCopyState("copied"),
			() => setCopyState("failed")
		);
		timeoutRef.current = setTimeout(() => setCopyState("idle"), 2500);
	};

	return (
		<div className="flex flex-col gap-2">
			<div
				aria-label="Install method"
				className="flex items-center"
				role="radiogroup"
			>
				{(["npm", "pnpm", "yarn", "bun", "skill"] as InstallOption[]).map(
					(p) => (
						<Fragment key={p}>
							<label className="relative flex h-6 cursor-pointer touch-manipulation items-center rounded-md px-3 font-medium text-(--gray-a11) text-xs transition-colors duration-150 ease-out not-has-checked:hover:text-(--gray-a12) has-checked:bg-(--gray-a3) has-checked:text-(--gray-a12) has-focus-visible:outline-(--gray-a11) has-focus-visible:outline-2 has-focus-visible:outline-offset-2 forced-colors:has-checked:bg-[Highlight] forced-colors:has-checked:text-[HighlightText]">
								<input
									checked={pm === p}
									className="sr-only"
									name="install-method"
									onChange={() => setPm(p)}
									type="radio"
									value={p}
								/>
								{p}
							</label>
							{p === "bun" && (
								<Separator
									aria-hidden="true"
									className="mx-1.5 my-1 rounded-full"
									orientation="vertical"
								/>
							)}
						</Fragment>
					)
				)}
			</div>
			<div className="hover:hover-border-shadow flex w-full items-center justify-between overflow-hidden rounded-xl border-shadow bg-white p-3 transition-shadow duration-200 ease-out">
				<div className="flex items-center gap-1.5">
					<span className="text-(--gray-a11) text-sm">$</span>
					<div className="flex text-(--gray-a12) text-sm">
						<span>{COMMANDS[pm]}</span>
					</div>
				</div>
				<button
					aria-label="Copy install command"
					className="group relative shrink-0 cursor-pointer touch-manipulation rounded-sm focus-visible:outline-(--gray-a11) focus-visible:outline-2 focus-visible:outline-offset-4"
					onClick={copy}
					type="button"
				>
					<div className="hit-area-3 relative size-4.5">
						<div
							className={cn(
								"absolute inset-0 flex items-center justify-center text-(--green-a10) transition-[opacity,filter,scale] duration-300 ease-out will-change-[opacity,filter,scale] motion-reduce:scale-100 motion-reduce:blur-none",
								copied
									? "scale-100 opacity-100 blur-0"
									: "scale-[0.25] opacity-0 blur-sm"
							)}
						>
							<svg
								aria-hidden="true"
								fill="currentColor"
								height="18"
								viewBox="0 0 640 640"
								width="18"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path d="M320 576C178.6 576 64 461.4 64 320C64 178.6 178.6 64 320 64C461.4 64 576 178.6 576 320C576 461.4 461.4 576 320 576zM438 209.7C427.3 201.9 412.3 204.3 404.5 215L285.1 379.2L233 327.1C223.6 317.7 208.4 317.7 199.1 327.1C189.8 336.5 189.7 351.7 199.1 361L271.1 433C276.1 438 282.9 440.5 289.9 440C296.9 439.5 303.3 435.9 307.4 430.2L443.3 243.2C451.1 232.5 448.7 217.5 438 209.7z" />
							</svg>
						</div>
						<div
							className={cn(
								"text-(--gray-a11) transition-[opacity,filter,scale,color] duration-300 ease-out will-change-[opacity,filter,scale] group-hover:text-(--gray-a12) motion-reduce:scale-100 motion-reduce:blur-none",
								copied
									? "scale-[0.25] opacity-0 blur-sm"
									: "scale-100 opacity-100 blur-0"
							)}
						>
							<svg
								aria-hidden="true"
								fill="currentColor"
								height="18"
								viewBox="0 0 640 640"
								width="18"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path d="M352 512L128 512L128 288L176 288L176 224L128 224C92.7 224 64 252.7 64 288L64 512C64 547.3 92.7 576 128 576L352 576C387.3 576 416 547.3 416 512L416 464L352 464L352 512zM288 416L512 416C547.3 416 576 387.3 576 352L576 128C576 92.7 547.3 64 512 64L288 64C252.7 64 224 92.7 224 128L224 352C224 387.3 252.7 416 288 416z" />
							</svg>
						</div>
					</div>
				</button>
				<span className="sr-only" role="status">
					{COPY_ANNOUNCEMENTS[copyState]}
				</span>
			</div>
		</div>
	);
}
