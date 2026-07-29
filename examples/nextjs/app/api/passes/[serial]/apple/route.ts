import { WalletError } from "passlet";
import { rewardsCard } from "@/lib/wallet";

// Passlet signs with node-forge + jszip, so it needs the Node.js runtime.
// It will NOT work on the Edge runtime.
export const runtime = "nodejs";
// Passes are per-recipient and freshly signed — never let Next cache them.
export const dynamic = "force-dynamic";

/**
 * GET /api/passes/:serial/apple
 *
 * Returns the signed .pkpass bytes. Opening this URL in iOS Safari hands the
 * file straight to Wallet's "Add Pass" sheet.
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ serial: string }> }
) {
	const { serial } = await params;

	try {
		// `apple` is a Uint8Array (the .pkpass archive), `google` is a JWT string.
		// Both providers run in parallel; here we only use the Apple half.
		const { apple, warnings } = await rewardsCard.create({
			serialNumber: serial, // must be unique per recipient
			values: { points: "1250" }, // fills field values for this holder
			barcode: { format: "QR", value: serial, altText: serial },
		});

		// Non-fatal notices (missing optional image, etc.) — worth logging.
		if (warnings.length > 0) {
			console.warn("[passlet]", warnings);
		}

		if (!apple) {
			// Only happens when the Wallet was built without Apple credentials.
			return new Response("Apple Wallet is not configured", { status: 501 });
		}

		return new Response(apple, {
			headers: {
				// EXACT MIME type — iOS Safari refuses to open the pass otherwise.
				"Content-Type": "application/vnd.apple.pkpass",
				// `attachment` + a .pkpass filename. Quote the filename and keep it
				// ASCII-safe; the extension is what makes Android/desktop downloads
				// land as a usable file.
				"Content-Disposition": `attachment; filename="${sanitize(serial)}.pkpass"`,
				"Content-Length": String(apple.byteLength),
				// Passes embed personal data and a signature — never cache them in a
				// CDN or shared proxy.
				"Cache-Control": "no-store, private",
			},
		});
	} catch (error) {
		if (error instanceof WalletError) {
			// Stable, switchable codes: APPLE_MISSING_ICON, APPLE_INVALID_SIGNER_CERT,
			// CREATE_CONFIG_INVALID, ...
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
