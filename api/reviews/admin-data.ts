import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

interface Review {
  id: string;
  projectId: string;
  name: string;
  rating: number;
  comment: string;
  status: "pending" | "approved";
  createdAt: number;
}

/**
 * Returns every review (pending + approved) for the moderation queue.
 * Gated by a shared-secret password (REVIEWS_ADMIN_PASSWORD), sent as a
 * bearer token — this is a lightweight gate suitable for a single-admin
 * personal site, not full auth (no lockout/rate-limit on wrong attempts).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminPassword = process.env.REVIEWS_ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(500).json({ error: "Admin password is not configured" });
    return;
  }

  const authHeader = req.headers.authorization;
  const providedPassword = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (providedPassword !== adminPassword) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    res.status(500).json({ error: "Review store is not configured" });
    return;
  }

  try {
    const redis = new Redis({ url: kvUrl, token: kvToken });
    const all = await redis.hgetall<Record<string, string>>("reviews");

    const reviews: Review[] = Object.values(all ?? {})
      .map((raw) => {
        try {
          return typeof raw === "string" ? (JSON.parse(raw) as Review) : (raw as unknown as Review);
        } catch {
          return null;
        }
      })
      .filter((review): review is Review => review !== null)
      .sort((a, b) => b.createdAt - a.createdAt);

    // Read-only peek at the view count — must never use incr() here, that's
    // the public /api/views.ts endpoint's job. Reading it must not inflate it.
    const totalViews = (await redis.get<number>("views")) ?? 0;

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ reviews, totalViews });
  } catch {
    res.status(500).json({ error: "Could not load reviews" });
  }
}
