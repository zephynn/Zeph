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

/** Approve or reject (delete) a pending review. Gated the same way as admin-data.ts. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

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

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
  const { id, action } = body as { id?: string; action?: "approve" | "reject" };

  if (typeof id !== "string" || !id || (action !== "approve" && action !== "reject")) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const redis = new Redis({ url: kvUrl, token: kvToken });

    if (action === "reject") {
      await redis.hdel("reviews", id);
      res.status(200).json({ ok: true });
      return;
    }

    const raw = await redis.hget<string>("reviews", id);
    if (!raw) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    const review: Review = typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as Review);
    review.status = "approved";
    await redis.hset("reviews", { [id]: JSON.stringify(review) });

    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not update review" });
  }
}
