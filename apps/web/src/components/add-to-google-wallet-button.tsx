import { Button } from "@passlet/ui/components/button";

export function AddToGoogleWalletButton(
	props: React.ComponentPropsWithoutRef<typeof Button>
) {
	return (
		<Button className="" variant="default" {...props}>
			<svg
				aria-hidden="true"
				fill="white"
				height="20"
				viewBox="0 0 640 640"
				width="20"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="M564 325.8C564 467.3 467.1 568 324 568C186.8 568 76 457.2 76 320C76 182.8 186.8 72 324 72C390.8 72 447 96.5 490.3 136.9L422.8 201.8C334.5 116.6 170.3 180.6 170.3 320C170.3 406.5 239.4 476.6 324 476.6C422.2 476.6 459 406.2 464.8 369.7L324 369.7L324 284.4L560.1 284.4C562.4 297.1 564 309.3 564 325.8z" />
			</svg>
			<span className="whitespace-nowrap font-medium">
				Add to Google Wallet
			</span>
		</Button>
	);
}
