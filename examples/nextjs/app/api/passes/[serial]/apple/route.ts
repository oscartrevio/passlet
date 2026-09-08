import { APPLE_PASS_CONTENT_TYPE, WalletError } from "passlet";
import { rewardsCard } from "@/lib/wallet";

// Apple pass signing requires the Node.js runtime.
export const runtime = "nodejs";
// Passes are per-recipient and freshly signed — never let Next cache them.
export const dynamic = "force-dynamic";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ serial: string }> }
) {
	const { serial } = await params;

	try {
		const { apple, warnings } = await rewardsCard.create({
			serialNumber: serial,
			values: { points: "1250" },
			barcode: { format: "QR", value: serial, altText: serial },
		});

		if (warnings.length > 0) {
			console.warn("[passlet]", warnings);
		}

		if (!apple) {
			return new Response("Apple Wallet is not configured", { status: 501 });
		}

		return new Response(apple, {
			headers: {
				"Content-Type": APPLE_PASS_CONTENT_TYPE,
				"Content-Disposition": `attachment; filename="${sanitize(serial)}.pkpass"`,
				"Content-Length": String(apple.byteLength),
				// Passes contain personal data; never cache them in a shared proxy.
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

/** Keep the filename header well-formed for arbitrary serial numbers. */
function sanitize(value: string): string {
	return value.replace(/[^\w.-]/g, "_");
}
