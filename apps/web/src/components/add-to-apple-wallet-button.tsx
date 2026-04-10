import { Button, buttonVariants } from "@passlet/ui/components/button";
import { cn } from "@passlet/ui/lib/utils";

interface AddToAppleWalletButtonProps {
	className?: string;
	href?: string;
	onClick?: () => void;
}

const walletClass =
	"inline-flex items-center gap-[7px] rounded-full bg-[#262626] px-4 py-[11px] h-auto hover:bg-[#262626]/90";

export function AddToAppleWalletButton({
	href,
	onClick,
	className,
}: AddToAppleWalletButtonProps) {
	const inner = (
		<>
			{/* Apple Wallet stacked-cards icon */}
			<svg
				aria-hidden="true"
				fill="none"
				height="19"
				viewBox="0 0 26 19"
				width="26"
				xmlns="http://www.w3.org/2000/svg"
			>
				<rect fill="#F2F2F2" height="4" rx="1.5" width="26" y="0" />
				<rect fill="#FBBC04" height="5" rx="1.5" width="26" y="4" />
				<rect fill="#34A853" height="5" rx="1.5" width="26" y="9" />
				<rect
					fill="url(#apple-wallet-grad)"
					height="5"
					rx="1.5"
					width="26"
					y="14"
				/>
				<defs>
					<linearGradient
						gradientUnits="userSpaceOnUse"
						id="apple-wallet-grad"
						x1="0"
						x2="26"
						y1="0"
						y2="0"
					>
						<stop stopColor="#4285F4" />
						<stop offset="1" stopColor="#1B74E8" />
					</linearGradient>
				</defs>
			</svg>
			<span className="whitespace-nowrap font-medium text-sm text-white leading-[18px] tracking-[-0.14px]">
				Add to Apple Wallet
			</span>
		</>
	);

	if (href) {
		return (
			<a
				className={cn(
					buttonVariants({ variant: "default" }),
					walletClass,
					className
				)}
				href={href}
				rel="noopener noreferrer"
				target="_blank"
			>
				{inner}
			</a>
		);
	}

	return (
		<Button className={cn(walletClass, className)} onClick={onClick}>
			{inner}
		</Button>
	);
}
