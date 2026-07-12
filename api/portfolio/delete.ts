import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

/** Password-gated. Note: does not cascade-delete reviews tagged to this slug — they just fall back to showing "General" in the reviews feed. */
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
    res.status(500).json({ error: "Portfolio store is not configured" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
  const { slug } = body as { slug?: string };

  if (typeof slug !== "string" || !slug) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const redis = new Redis({ url: kvUrl, token: kvToken });
    await redis.hdel("portfolio", slug);
    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not delete project" });
  }
}
