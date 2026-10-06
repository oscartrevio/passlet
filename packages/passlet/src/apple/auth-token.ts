import { createHmac, timingSafeEqual } from "node:crypto";

// Versioned domain prefix so these HMACs can never collide with any other use
// of the same secret. Never change it: every issued pass embeds its token, and
// Apple forbids changing `authenticationToken` in an update.
const DOMAIN = "passlet/apple-auth/v1\0";

/**
 * The `authenticationToken` for one pass:
 * base64url(HMAC-SHA256(secret, domain + passTypeIdentifier + "\0" + serialNumber)).
 *
 * Deriving it means no token storage, and a leaked token unlocks one pass only.
 * Frozen forever: issued passes embed it.
 */
export function appleAuthToken(
	secret: string,
	passTypeIdentifier: string,
	serialNumber: string
): string {
	return createHmac("sha256", secret)
		.update(`${DOMAIN}${passTypeIdentifier}\0${serialNumber}`)
		.digest("base64url");
}

/**
 * Whether `token` is this pass's token. The comparison is constant-time, so
 * response timing doesn't reveal how much of a guess matched.
 */
export function isAppleAuthToken(
	secret: string,
	passTypeIdentifier: string,
	serialNumber: string,
	token: string
): boolean {
	const presented = Buffer.from(token);
	const expected = Buffer.from(
		appleAuthToken(secret, passTypeIdentifier, serialNumber)
	);
	// Every derived token has the same length, so comparing lengths first
	// leaks nothing secret; timingSafeEqual needs equal lengths.
	return (
		presented.length === expected.length && timingSafeEqual(presented, expected)
	);
}
