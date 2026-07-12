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

/** Public — only ever returns approved reviews, optionally filtered to one project. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    res.status(200).json({ reviews: [] });
    return;
  }

  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;

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
      .filter((review): review is Review => review !== null && review.status === "approved")
      .filter((review) => !projectId || review.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ reviews });
  } catch {
    res.status(200).json({ reviews: [] });
  }
}
