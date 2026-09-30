/**
 * Releases a response body we will not read, without waiting for it.
 *
 * Next.js hands server code a `tee()` branch of every `fetch` body, and a
 * branch's `cancel()` only settles once its sibling is cancelled too — which
 * never happens — so awaiting it hangs the request until the platform kills it.
 */
export function discardBody(response: Response): void {
	response.body?.cancel().catch(() => undefined);
}
