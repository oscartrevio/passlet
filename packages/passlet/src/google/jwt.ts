import { type KeyObject, sign } from "node:crypto";
import { WalletError } from "../errors";

const HEADER = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
	"base64url"
);

/**
 * Compact RS256 JWS over a JSON payload.
 *
 * @throws {WalletError} `GOOGLE_SIGNING_FAILED` if the key cannot sign.
 */
export function signJwt(payload: object, privateKey: KeyObject): string {
	const data = `${HEADER}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
	try {
		return `${data}.${sign("sha256", Buffer.from(data), privateKey).toString("base64url")}`;
	} catch (cause) {
		throw new WalletError("GOOGLE_SIGNING_FAILED", undefined, {
			cause: cause instanceof Error ? cause : undefined,
		});
	}
}
