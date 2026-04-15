import { cn } from "@passlet/ui/lib/utils";
import QR from "qrcode";
import type { QRCodeServerProps } from "./types";

export const QRCode = async ({
	data,
	foreground,
	background,
	robustness = "M",
	className,
	...props
}: QRCodeServerProps) => {
	const svg = await QR.toString(data, {
		type: "svg",
		color: {
			dark: foreground,
			light: background,
		},
		width: 200,
		errorCorrectionLevel: robustness,
	});

	if (!svg) {
		throw new Error("Failed to generate QR code");
	}

	return (
		<div
			className={cn("size-full", "[&_svg]:size-full", className)}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: "Required for SVG"
			dangerouslySetInnerHTML={{ __html: svg }}
			{...props}
		/>
	);
};
