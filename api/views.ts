import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const VIEWS_KEY = "views";

/**
 * Increments and returns the site's total view count on every call.
 * This is a raw hit counter (page loads), not deduped unique visitors —
 * refreshes and bots count too, same as any simple vanity counter.
 * Backed by Upstash Redis (added to the Vercel project via the Marketplace
 * "Upstash" integration). That integration provisions the legacy Vercel KV
 * env var names (KV_REST_API_URL / KV_REST_API_TOKEN) rather than
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, so we read those
 * explicitly instead of using Redis.fromEnv()'s default names.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error("missing KV_REST_API_URL/TOKEN");

    const redis = new Redis({ url, token });
    const count = await redis.incr(VIEWS_KEY);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ count });
  } catch {
    res.status(500).json({ error: "View counter store is not configured" });
  }
}
