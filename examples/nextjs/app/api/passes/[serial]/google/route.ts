import { googleSaveUrl, WalletError } from "passlet";
import { rewardsCard } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ serial: string }> }
) {
	const { serial } = await params;

	try {
		const { google, warnings } = await rewardsCard.create({
			serialNumber: serial,
			values: { points: "1250" },
			barcode: { format: "QR", value: serial },
		});

		if (warnings.length > 0) {
			console.warn("[passlet]", warnings);
		}

		if (!google) {
			return new Response("Google Wallet is not configured", { status: 501 });
		}

		return new Response(null, {
			status: 302,
			headers: {
				Location: googleSaveUrl(google),
				// Save links are recipient-specific; keep the redirect uncached.
				"Cache-Control": "no-store, private",
			},
		});
	} catch (error) {
		if (error instanceof WalletError) {
			console.error(error.code, error.message);
			return new Response(`Pass generation failed: ${error.code}`, {
				status: 500,
			});
		}
		throw error;
	}
}
