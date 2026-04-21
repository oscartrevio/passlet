import { QRCode } from "@passlet/ui/components/qr-code/server";
import { cookies } from "next/headers";
import Link from "next/link";
import { InstallCommand } from "@/components/install-command";
import { PassPlayground } from "@/components/pass-playground";
import {
	DEFAULT_PASSLET_ID,
	PASSLET_COLOR_COOKIE,
	PASSLET_ID_COOKIE,
} from "@/lib/cookies";
import { DEFAULT_COLOR, features, isColorValue } from "@/lib/data";
import { version } from "../../../../packages/passlet/package.json";

export default async function Home() {
	const cookieStore = await cookies();
	const memberNo =
		cookieStore.get(PASSLET_ID_COOKIE)?.value ?? DEFAULT_PASSLET_ID;
	const rawColor = cookieStore.get(PASSLET_COLOR_COOKIE)?.value;
	const initialColor =
		rawColor && isColorValue(rawColor) ? rawColor : DEFAULT_COLOR;

	const qrSlot = (
		<QRCode
			background="#ffffff"
			data="https://github.com/oscartrevio/passlet"
			foreground="#111111"
			robustness="M"
		/>
	);

	return (
		<div className="flex min-h-svh flex-col lg:h-svh lg:min-h-0 lg:flex-row">
			{/* Left Column — Pass preview & configuration */}
			<div className="bg-(--gray-a2) lg:sticky lg:top-0 lg:flex lg:h-svh lg:w-[38%] lg:items-stretch">
				<div className="flex w-full flex-col gap-6 px-6 py-8 lg:h-full lg:justify-center lg:gap-8 lg:px-10 lg:py-10">
					<PassPlayground
						initialColor={initialColor}
						memberNo={memberNo}
						qrSlot={qrSlot}
					/>
				</div>
			</div>

			{/* Right Column — Library information & documentation */}
			<div className="flex w-full flex-col lg:h-svh lg:w-[62%] lg:overflow-y-auto">
				<div className="flex flex-1 flex-col gap-18 px-6 py-10 lg:px-10 lg:py-10">
					<div className="flex flex-col gap-3">
						<h1 className="text-balance font-semibold text-(--gray-a12) text-2xl tracking-tighter">
							Passlet
						</h1>
						<p className="text-(--gray-a11) text-sm leading-normal">
							One API for Apple Wallet and Google Wallet passes.
							<br />
							Define a pass once and get .pkpass for Apple, JWT for Google.
						</p>
					</div>

					<div className="flex flex-col gap-3">
						<h2 className="text-balance font-semibold text-(--gray-a12) text-sm">
							Install to get started
						</h2>
						<InstallCommand />
					</div>

					<div className="flex flex-col gap-3">
						<h2 className="text-balance font-semibold text-(--gray-a12) text-sm">
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
										<span className="text-balance font-semibold text-(--gray-a12) text-sm">
											{label}
										</span>
									</div>
									<span className="text-right font-medium text-(--gray-a8) text-sm transition-colors duration-150 ease-out group-hover:text-(--gray-a9)">
										{description}
									</span>
								</div>
							))}
						</div>
					</div>

					<div className="mt-auto flex items-center justify-between pb-[env(safe-area-inset-bottom)] font-medium">
						<span className="text-(--gray-a8) text-xs">
							Created by{" "}
							<Link
								className="transition-colors hover:text-(--gray-a9)"
								href="https://oscartrevio.xyz"
								rel="noopener noreferrer"
								target="_blank"
							>
								Oscar Treviño
							</Link>
						</span>
						<Link
							className="text-(--gray-a8) text-xs transition-colors hover:text-(--gray-a9)"
							href="https://github.com/oscartrevio/passlet"
							rel="noopener noreferrer"
							target="_blank"
						>
							v{version} • GitHub
						</Link>
					</div>
				</div>
			</div>
		</div>
	);
}
