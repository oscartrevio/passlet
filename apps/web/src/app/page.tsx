import { QRCode } from "@passlet/ui/components/qr-code/server";
import { cookies } from "next/headers";
import Link from "next/link";
import { InstallCommand } from "@/components/install-command";
import { PassPlayground } from "@/components/pass-playground";
import type { ColorValue } from "@/lib/data";
import { version } from "../../../../packages/passlet/package.json";

const s = (fill: string) =>
	({
		height: 18,
		width: 18,
		fill,
		viewBox: "0 0 640 640",
		xmlns: "http://www.w3.org/2000/svg",
		style: { flexShrink: 0 },
	}) as const;

const features = [
	{
		icon: (
			<svg {...s("#30A34A")}>
				<title>Wallet</title>
				<path d="M128 96C92.7 96 64 124.7 64 160L64 448C64 483.3 92.7 512 128 512L512 512C547.3 512 576 483.3 576 448L576 256C576 220.7 547.3 192 512 192L136 192C122.7 192 112 181.3 112 168C112 154.7 122.7 144 136 144L520 144C533.3 144 544 133.3 544 120C544 106.7 533.3 96 520 96L128 96zM480 320C497.7 320 512 334.3 512 352C512 369.7 497.7 384 480 384C462.3 384 448 369.7 448 352C448 334.3 462.3 320 480 320z" />
			</svg>
		),
		label: "One API, both wallets",
		description: "Apple and Google output.",
	},
	{
		icon: (
			<svg {...s("#F9CC16")}>
				<title>Layers</title>
				<path d="M296.5 69.2C311.4 62.3 328.6 62.3 343.5 69.2L562.1 170.2C570.6 174.1 576 182.6 576 192C576 201.4 570.6 209.9 562.1 213.8L343.5 314.8C328.6 321.7 311.4 321.7 296.5 314.8L77.9 213.8C69.4 209.8 64 201.3 64 192C64 182.7 69.4 174.1 77.9 170.2L296.5 69.2zM112.1 282.4L276.4 358.3C304.1 371.1 336 371.1 363.7 358.3L528 282.4L562.1 298.2C570.6 302.1 576 310.6 576 320C576 329.4 570.6 337.9 562.1 341.8L343.5 442.8C328.6 449.7 311.4 449.7 296.5 442.8L77.9 341.8C69.4 337.8 64 329.3 64 320C64 310.7 69.4 302.1 77.9 298.2L112 282.4zM77.9 426.2L112 410.4L276.3 486.3C304 499.1 335.9 499.1 363.6 486.3L527.9 410.4L562 426.2C570.5 430.1 575.9 438.6 575.9 448C575.9 457.4 570.5 465.9 562 469.8L343.4 570.8C328.5 577.7 311.3 577.7 296.4 570.8L77.9 469.8C69.4 465.8 64 457.3 64 448C64 438.7 69.4 430.1 77.9 426.2z" />
			</svg>
		),
		label: "Six pass types",
		description: "All pass types supported.",
	},
	{
		icon: (
			<svg {...s("#EA580C")}>
				<title>Hexagon</title>
				<path d="M288.3 61.5C308.1 50.1 332.5 50.1 352.3 61.5L528.2 163C548 174.4 560.2 195.6 560.2 218.4L560.2 421.4C560.2 444.3 548 465.4 528.2 476.8L352.3 578.5C332.5 589.9 308.1 589.9 288.3 578.5L112.5 477C92.7 465.6 80.5 444.4 80.5 421.6L80.5 218.6C80.5 195.7 92.7 174.6 112.5 163.2L288.3 61.5zM496.1 421.5L496.1 255.4L352.3 338.4L352.3 504.5L496.1 421.5z" />
			</svg>
		),
		label: "Unified fields",
		description: "One field model. Both layouts.",
	},
	{
		icon: (
			<svg {...s("#DC2626")}>
				<title>Palette</title>
				<path d="M576 320C576 320.9 576 321.8 576 322.7C575.6 359.2 542.4 384 505.9 384L408 384C381.5 384 360 405.5 360 432C360 435.4 360.4 438.7 361 441.9C363.1 452.1 367.5 461.9 371.8 471.8C377.9 485.6 383.9 499.3 383.9 513.8C383.9 545.6 362.3 574.5 330.5 575.8C327 575.9 323.5 576 319.9 576C178.5 576 63.9 461.4 63.9 320C63.9 178.6 178.6 64 320 64C461.4 64 576 178.6 576 320zM192 352C192 334.3 177.7 320 160 320C142.3 320 128 334.3 128 352C128 369.7 142.3 384 160 384C177.7 384 192 369.7 192 352zM192 256C209.7 256 224 241.7 224 224C224 206.3 209.7 192 192 192C174.3 192 160 206.3 160 224C160 241.7 174.3 256 192 256zM352 160C352 142.3 337.7 128 320 128C302.3 128 288 142.3 288 160C288 177.7 302.3 192 320 192C337.7 192 352 177.7 352 160zM448 256C465.7 256 480 241.7 480 224C480 206.3 465.7 192 448 192C430.3 192 416 206.3 416 224C416 241.7 430.3 256 448 256z" />
			</svg>
		),
		label: "Full visual control",
		description: "Colors, icons, logos, barcodes.",
	},
	{
		icon: (
			<svg {...s("#7C3AED")}>
				<title>Toggle</title>
				<path d="M224 128C118 128 32 214 32 320C32 426 118 512 224 512L416 512C522 512 608 426 608 320C608 214 522 128 416 128L224 128zM416 224C469 224 512 267 512 320C512 373 469 416 416 416C363 416 320 373 320 320C320 267 363 224 416 224z" />
			</svg>
		),
		label: "Platform optional",
		description: "Omit a provider. Passlet skips it.",
	},
	{
		icon: (
			<svg {...s("#2E63EB")}>
				<title>TypeScript</title>
				<path d="M112.8 96L527.2 96C536.5 96 544 103.5 544 112.8L544 527.2C544 536.5 536.5 544 527.2 544L112.8 544C103.5 544 96 536.5 96 527.2L96 112.8C96 103.5 103.5 96 112.8 96zM345 334.3L345 297.6L185.6 297.6L185.6 334.3L242.5 334.3L242.5 497.9L287.8 497.9L287.8 334.3L345 334.3zM363.1 493.6C370.4 497.3 379 500.1 389 502C399 503.9 409.5 504.8 420.5 504.8C431.3 504.8 441.5 503.8 451.2 501.7C460.9 499.6 469.4 496.3 476.7 491.6C484 486.9 489.8 480.7 494.1 473.2C498.4 465.7 500.5 456.2 500.5 445C500.5 436.9 499.3 429.8 496.8 423.7C494.3 417.6 490.9 412.2 486.3 407.4C481.7 402.6 476.2 398.4 469.8 394.6C463.4 390.8 456.1 387.3 448.1 383.9C442.2 381.5 436.9 379.1 432.2 376.8C427.5 374.5 423.5 372.2 420.3 369.8C417.1 367.4 414.5 364.9 412.7 362.3C410.9 359.7 410 356.6 410 353.3C410 350.2 410.8 347.5 412.4 345C414 342.5 416.2 340.4 419.1 338.6C422 336.8 425.6 335.5 429.8 334.5C434 333.5 438.7 333 443.9 333C447.6 333 451.6 333.3 455.8 333.8C460 334.3 464.2 335.2 468.4 336.4C472.6 337.6 476.7 339 480.7 340.8C484.7 342.6 488.4 344.6 491.7 346.9L491.7 305.1C484.9 302.5 477.4 300.6 469.3 299.3C461.2 298 451.9 297.4 441.4 297.4C430.7 297.4 420.6 298.5 411 300.8C401.4 303.1 393 306.6 385.8 311.5C378.6 316.4 372.8 322.5 368.6 330C364.4 337.5 362.3 346.5 362.3 356.9C362.3 370.2 366.2 381.6 373.9 391C381.6 400.4 393.4 408.4 409.1 414.9C415.3 417.4 421 419.9 426.4 422.3C431.8 424.7 436.4 427.2 440.2 429.8C444 432.4 447.2 435.2 449.4 438.3C451.6 441.4 452.8 444.9 452.8 448.8C452.8 451.7 452.1 454.4 450.7 456.8C449.3 459.2 447.2 461.4 444.3 463.2C441.4 465 437.9 466.4 433.6 467.5C429.3 468.6 424.3 469 418.6 469C408.9 469 399.2 467.3 389.7 463.9C380.2 460.5 371.3 455.4 363.1 448.6L363.1 493.3z" />
			</svg>
		),
		label: "TypeScript native",
		description: "Full type safety out of the box.",
	},
];

export default async function Home() {
	const cookieStore = await cookies();
	const memberNo = cookieStore.get("passlet-id")?.value ?? "000000";
	const initialColor = (cookieStore.get("passlet-color")?.value ??
		"blue") as ColorValue;

	return (
		<div className="flex min-h-svh flex-col font-open-runde">
			{/* Playground hero */}
			<div className="w-full bg-[#FAFAFA] py-12">
				<div className="mx-auto max-w-xl px-4">
					<PassPlayground
						initialColor={initialColor}
						memberNo={memberNo}
						qrSlot={
							<QRCode
								background="#ffffff"
								data="https://github.com/oscartrevio/passlet"
								foreground="#111111"
								robustness="M"
							/>
						}
					/>
				</div>
			</div>

			{/* Content */}
			<div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-18 px-4 py-12">
				{/* Title + subtitle */}
				<div className="flex flex-col gap-3">
					<h1 className="text-balance font-semibold text-2xl text-[#1E1E1E] tracking-tighter">
						Passlet
					</h1>
					<p className="text-[#707070] text-sm leading-normal">
						One API for Apple Wallet and Google Wallet passes.
						<br />
						Define a pass once and get .pkpass for Apple, JWT for Google.
					</p>
				</div>

				{/* Install */}
				<div className="flex flex-col gap-3">
					<h2 className="text-balance font-semibold text-[#1E1E1E] text-sm">
						Install to get started
					</h2>
					<InstallCommand />
				</div>

				{/* What you get */}
				<div className="flex flex-col gap-3">
					<h2 className="text-balance font-semibold text-[#1E1E1E] text-sm">
						What you get
					</h2>
					<div className="flex flex-col gap-2.5">
						{features.map(({ icon, label, description }) => (
							<div
								className="group hit-area-y-1.5 flex items-center justify-between"
								key={label}
							>
								<div className="flex items-center gap-1">
									{icon}
									<span className="text-balance font-semibold text-[#1E1E1E] text-sm">
										{label}
									</span>
								</div>
								<span className="text-right font-medium text-[#B8B8B8] text-sm transition-colors duration-150 ease-out group-hover:text-[#8A8A8A]">
									{description}
								</span>
							</div>
						))}
					</div>
				</div>

				{/* Footer */}
				<div className="mt-auto flex items-center justify-between pb-[env(safe-area-inset-bottom)]">
					<span className="text-[#B8B8B8] text-xs">
						Created by{" "}
						<Link
							className="transition-colors hover:text-[#707070]"
							href="https://oscartrevio.xyz"
							rel="noopener noreferrer"
							target="_blank"
						>
							Oscar Treviño
						</Link>
					</span>
					<Link
						className="text-[#B8B8B8] text-xs transition-colors hover:text-[#707070]"
						href="https://github.com/oscartrevio/passlet"
						rel="noopener noreferrer"
						target="_blank"
					>
						v{version} • GitHub
					</Link>
				</div>
			</div>
		</div>
	);
}
