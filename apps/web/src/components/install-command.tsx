"use client";

import { cn } from "@passlet/ui/lib/utils";
import { useRef, useState } from "react";
import { TextMorph } from "torph/react";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const COMMANDS: Record<PackageManager, string> = {
	npm: "npm i passlet",
	pnpm: "pnpm i passlet",
	yarn: "yarn add passlet",
	bun: "bun i passlet",
};

export function InstallCommand() {
	const [pm, setPm] = useState<PackageManager>("npm");
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const copy = () => {
		navigator.clipboard.writeText(COMMANDS[pm]);
		setCopied(true);
		clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => setCopied(false), 2500);
	};

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex gap-3.5">
				{(["npm", "pnpm", "yarn", "bun"] as PackageManager[]).map((p) => (
					<button
						className={cn(
							"hit-area-2 cursor-pointer touch-manipulation font-medium text-xs transition-colors",
							pm === p
								? "text-[#1E1E1E]"
								: "text-[#B8B8B8] hover:text-[#707070]"
						)}
						key={p}
						onClick={() => setPm(p)}
						type="button"
					>
						{p}
					</button>
				))}
			</div>
			<div className="hover:hover-border-shadow flex w-full items-center justify-between overflow-hidden rounded-xl border-shadow bg-white p-3 transition-shadow duration-150">
				<div className="flex items-center gap-1.5">
					<span className="text-[#9A9A9A] text-sm">$</span>
					<div className="flex text-[#1E1E1E] text-sm">
						<TextMorph>{COMMANDS[pm]}</TextMorph>
					</div>
				</div>
				<button
					aria-label="Copy install command"
					className="group relative shrink-0 cursor-pointer touch-manipulation"
					onClick={copy}
					type="button"
				>
					<div className="hit-area-3 relative size-4.5">
						<div
							className={cn(
								"absolute inset-0 flex items-center justify-center text-[#30A34A] transition-[opacity,filter,scale] duration-300 ease-in-out will-change-[opacity,filter,scale]",
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
								"text-[#B8B8B8] transition-[opacity,filter,scale,color] duration-300 ease-in-out will-change-[opacity,filter,scale] group-hover:text-[#707070]",
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
			</div>
		</div>
	);
}
