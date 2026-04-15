import type { HTMLAttributes } from "react";

export type QRErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QRCodeBaseProps extends HTMLAttributes<HTMLDivElement> {
	data: string;
	robustness?: QRErrorCorrectionLevel;
}

export interface QRCodeClientProps extends QRCodeBaseProps {
	background?: string;
	foreground?: string;
}

export interface QRCodeServerProps extends QRCodeBaseProps {
	background: string;
	foreground: string;
}
