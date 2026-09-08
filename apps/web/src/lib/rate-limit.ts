import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Upstash's Vercel integration uses either prefix.
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token =
	process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

// Local development does not require Redis.
const redis = url && token ? new Redis({ url, token }) : null;

const ratelimit = redis
	? new Ratelimit({
			redis,
			limiter: Ratelimit.slidingWindow(5, "1 m"),
			prefix: "passlet:create",
			analytics: true,
		})
	: null;

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
 * Usage counters in Upstash:
 * GET passlet:total; ZREVRANGE passlet:members 0 -1 WITHSCORES; HGETALL passlet:providers.
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
