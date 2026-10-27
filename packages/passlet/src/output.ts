/** Result of `template.create()`. */
export interface IssuedPass {
	/**
	 * Signed `.pkpass` archive ready to serve, or `null` if Apple credentials were omitted.
	 *
	 * Serve it under the `APPLE_PASS_CONTENT_TYPE` content type — iOS refuses passes
	 * sent under any other type. On Node HTTP servers wrap it with `Buffer.from(apple)`.
	 */
	apple: Uint8Array<ArrayBuffer> | null;
	/**
	 * Signed JWT for a Google Wallet save link, or `null` if Google credentials were omitted.
	 *
	 * Pass it to the exported `googleSaveUrl(jwt)` helper to get the
	 * `https://pay.google.com/gp/v/save/<jwt>` URL to link or redirect to.
	 */
	google: string | null;
}

/** Result of `wallet.createBundle()`. */
export interface IssuedBundle {
	/**
	 * A `.pkpasses` bundle holding one signed `.pkpass` per item, or `null` if
	 * Apple credentials were omitted. Always a bundle, even for one item.
	 *
	 * Serve it under the `APPLE_PASSES_CONTENT_TYPE` content type. On Node HTTP
	 * servers wrap it with `Buffer.from(apple)`.
	 */
	apple: Uint8Array<ArrayBuffer> | null;
	/**
	 * One signed JWT whose save link adds every item to Google Wallet, or `null`
	 * if Google credentials were omitted. Pass it to `googleSaveUrl(jwt)`.
	 */
	google: string | null;
}

/** Result of `wallet.update()`. */
export interface UpdateResult {
	/** Apple devices notified, or `null` without `apple.webService`. */
	apple: {
		/** Pushes APNs did not accept, after one retry on a new connection. */
		failed: number;
		/** Devices APNs accepted a push for. */
		notified: number;
		/** Registrations dropped because APNs reported the device gone. */
		removed: number;
	} | null;
	/** What happened on Google, or `null` without Google credentials. */
	google: "updated" | "created" | null;
}

/**
 * `Content-Type` Apple Wallet requires when serving a `.pkpass` file.
 *
 * iOS silently refuses to open a pass served under any other type (a plain
 * `application/octet-stream` download is the most common failure), so use this
 * constant rather than retyping the string.
 *
 * @example
 * res.setHeader("Content-Type", APPLE_PASS_CONTENT_TYPE);
 * res.end(Buffer.from(apple)); // Buffer.from — `apple` is a Uint8Array
 */
export const APPLE_PASS_CONTENT_TYPE = "application/vnd.apple.pkpass";

/**
 * `Content-Type` for a `.pkpasses` bundle of several passes, as returned by
 * `wallet.createBundle()`.
 *
 * @example
 * res.setHeader("Content-Type", APPLE_PASSES_CONTENT_TYPE);
 * res.end(Buffer.from(apple));
 */
export const APPLE_PASSES_CONTENT_TYPE = "application/vnd.apple.pkpasses";

/**
 * Builds the "Add to Google Wallet" save link for a signed JWT — the `google`
 * value returned by `template.create()` and `wallet.createBundle()`.
 *
 * @example
 * const { google } = await card.create({ serialNumber: "user-123" });
 * if (google) {
 *   res.redirect(googleSaveUrl(google));
 * }
 */
export function googleSaveUrl(jwt: string): string {
	return `https://pay.google.com/gp/v/save/${jwt}`;
}
