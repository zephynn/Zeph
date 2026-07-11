import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const VIEWS_KEY = "views";

/**
 * Increments and returns the site's total view count on every call.
 * This is a raw hit counter (page loads), not deduped unique visitors —
 * refreshes and bots count too, same as any simple vanity counter.
 * Backed by Upstash Redis (added to the Vercel project via the Marketplace
 * "Upstash" integration) since serverless functions have no memory between
 * invocations. Redis.fromEnv() reads UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN, which the integration sets automatically.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const redis = Redis.fromEnv();
    const count = await redis.incr(VIEWS_KEY);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ count });
  } catch {
    res.status(500).json({ error: "View counter store is not configured" });
  }
}
