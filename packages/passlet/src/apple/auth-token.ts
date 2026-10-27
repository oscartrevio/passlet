import { createHmac, timingSafeEqual } from "node:crypto";

// Versioned domain prefix so these HMACs can never collide with any other use
// of the same secret. Never change it: every issued pass embeds its token, and
// Apple forbids changing `authenticationToken` in an update.
const DOMAIN = "passlet/apple-auth/v1\0";

/** The `authenticationToken`s of one web service's passes. */
export interface AppleAuthTokens {
	/** The token embedded in the pass `serialNumber`. */
	issue(serialNumber: string): string;
	/**
	 * Whether `token` is the pass's token. The comparison is constant-time, so
	 * response timing doesn't reveal how much of a guess matched.
	 */
	verifies(serialNumber: string, token: string): boolean;
}

/**
 * Each pass's token is
 * base64url(HMAC-SHA256(secret, domain + passTypeIdentifier + "\0" + serialNumber)).
 *
 * Deriving it means no token storage, and a leaked token unlocks one pass only.
 * Frozen forever: issued passes embed it.
 */
export function appleAuthTokens(
	secret: string,
	passTypeIdentifier: string
): AppleAuthTokens {
	const issue = (serialNumber: string) =>
		createHmac("sha256", secret)
			.update(`${DOMAIN}${passTypeIdentifier}\0${serialNumber}`)
			.digest("base64url");
	return {
		issue,
		verifies(serialNumber, token) {
			const presented = Buffer.from(token);
			const expected = Buffer.from(issue(serialNumber));
			// Every derived token has the same length, so comparing lengths first
			// leaks nothing secret; timingSafeEqual needs equal lengths.
			return (
				presented.length === expected.length &&
				timingSafeEqual(presented, expected)
			);
		},
	};
}
