import { type KeyObject, sign } from "node:crypto";

const HEADER = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
	"base64url"
);

/** Compact RS256 JWS over a JSON payload. */
export function signJwt(
	payload: Record<string, unknown>,
	privateKey: KeyObject
): string {
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const data = `${HEADER}.${body}`;
	const signature = sign("sha256", Buffer.from(data), privateKey);
	return `${data}.${signature.toString("base64url")}`;
}
