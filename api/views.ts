import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis } from "./_lib/redis";

const VIEWS_KEY = "views";

/**
 * Increments and returns the site's total view count on every call.
 * This is a raw hit counter (page loads), not deduped unique visitors —
 * refreshes and bots count too, same as any simple vanity counter.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const count = await getRedis().incr(VIEWS_KEY);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ count });
  } catch {
    res.status(500).json({ error: "View counter store is not configured" });
  }
}
