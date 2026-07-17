import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// The Vercel Upstash Marketplace integration injects these under either the
// UPSTASH_* or KV_* prefix depending on how the store was connected — accept both.
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token =
	process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

// One client, shared by the limiter and the usage counters. Null — and every
// function below no-ops / fails open — when Upstash isn't configured, so local
// dev and preview builds keep working without it.
const redis = url && token ? new Redis({ url, token }) : null;

const ratelimit = redis
	? new Ratelimit({
			redis,
			limiter: Ratelimit.slidingWindow(5, "1 m"),
			prefix: "passlet:create",
			analytics: true,
		})
	: null;

/**
 * Allow at most 5 pass creations per minute per identifier (client IP).
 * Returns true when within the limit. Fail-open when Upstash isn't configured.
 */
export async function checkRateLimit(identifier: string): Promise<boolean> {
	if (!ratelimit) {
		return true;
	}
	const { success } = await ratelimit.limit(identifier);
	return success;
}

const TOTAL_KEY = "passlet:total";
const MEMBERS_KEY = "passlet:members";
const PROVIDERS_KEY = "passlet:providers";

/**
 * Record one successful pass creation. View the results in the Upstash console:
 *   GET passlet:total                          → grand total
 *   ZREVRANGE passlet:members 0 -1 WITHSCORES  → members ranked by pass count
 *   HGETALL passlet:providers                  → apple vs google counts
 *
 * Best-effort — never throws, so a metrics hiccup can't fail a created pass.
 */
export async function recordPassCreated(
	memberName: string,
	provider: string
): Promise<void> {
	if (!redis) {
		return;
	}
	try {
		await Promise.all([
			redis.incr(TOTAL_KEY),
			redis.zincrby(MEMBERS_KEY, 1, memberName),
			redis.hincrby(PROVIDERS_KEY, provider, 1),
		]);
	} catch {
		// Swallow — usage metrics must never break pass creation.
	}
}
