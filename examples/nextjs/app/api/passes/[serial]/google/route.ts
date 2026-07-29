import { WalletError } from "passlet";
import { rewardsCard } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/passes/:serial/google
 *
 * Issues the pass and 302-redirects to the Google Wallet save link. Point an
 * "Add to Google Wallet" button at this URL and the user lands directly on the
 * save screen.
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ serial: string }> }
) {
	const { serial } = await params;

	try {
		// `google` is a signed JWT — the save URL is just the JWT appended to
		// https://pay.google.com/gp/v/save/
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
				Location: `https://pay.google.com/gp/v/save/${google}`,
				// The JWT is short-lived and recipient-specific: never cache the
				// redirect. (Next.js also caches 3xx aggressively without this.)
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
