import { Button, buttonVariants } from "@passlet/ui/components/button";
import { cn } from "@passlet/ui/lib/utils";

interface AddToGoogleWalletButtonProps {
	className?: string;
	href?: string;
	onClick?: () => void;
}

const walletClass =
	"inline-flex items-center gap-[7px] rounded-full bg-[#262626] px-4 py-[11px] h-auto hover:bg-[#262626]/90";

export function AddToGoogleWalletButton({
	href,
	onClick,
	className,
}: AddToGoogleWalletButtonProps) {
	const inner = (
		<>
			{/* Google Wallet stacked-cards icon */}
			<svg
				aria-hidden="true"
				fill="none"
				height="19"
				viewBox="21 12 30 26"
				width="22"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					d="M51 22H21V17C21 14.2857 23.2018 12 25.8165 12H46.1835C48.7982 12 51 14.2857 51 17V22Z"
					fill="#34A853"
				/>
				<path
					d="M51 26.0537H21V21.0537C21 18.3394 23.2018 16.0537 25.8165 16.0537H46.1835C48.7982 16.0537 51 18.3394 51 21.0537V26.0537Z"
					fill="#FBBC04"
				/>
				<path
					d="M51 30.2468H21V25.2468C21 22.5325 23.2018 20.2468 25.8165 20.2468H46.1835C48.7982 20.2468 51 22.5325 51 25.2468V30.2468Z"
					fill="#EA4335"
				/>
				<path
					d="M21 23.2752L40.0411 27.6789C42.2329 28.2294 44.6986 27.6789 46.4795 26.3028L51 23V33.3211C51 35.9358 48.8082 38 46.2055 38H25.7945C23.1918 38 21 35.9358 21 33.3211V23.2752Z"
					fill="#4285F4"
				/>
			</svg>
			<span className="whitespace-nowrap font-medium text-sm text-white leading-4.5 tracking-[-0.14px]">
				Add to Google Wallet
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
