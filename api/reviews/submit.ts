import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const MAX_NAME_LENGTH = 60;
const MAX_COMMENT_LENGTH = 600;
const RATE_LIMIT_SECONDS = 60;

/**
 * Public write endpoint — anyone can call this, so it's the one place on the
 * site that needs abuse resistance: a honeypot field bots tend to fill in
 * (real users never see it), and a per-IP cooldown. Neither is bulletproof,
 * but both cut down on trivial spam without requiring an account system.
 *
 * Reviews land as status "pending" — they only become visible via
 * api/reviews/list.ts after being approved through api/reviews/moderate.ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    res.status(500).json({ error: "Review store is not configured" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
  const { projectId, name, rating, comment, website } = body as {
    projectId?: string;
    name?: string;
    rating?: number;
    comment?: string;
    website?: string; // honeypot — real visitors never fill this in
  };

  // Honeypot tripped: pretend success so bots don't learn they were caught.
  if (typeof website === "string" && website.trim() !== "") {
    res.status(200).json({ ok: true });
    return;
  }

  if (
    typeof projectId !== "string" ||
    !projectId ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > MAX_NAME_LENGTH ||
    typeof comment !== "string" ||
    !comment.trim() ||
    comment.length > MAX_COMMENT_LENGTH ||
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    res.status(400).json({ error: "Invalid review" });
    return;
  }

  try {
    const redis = new Redis({ url: kvUrl, token: kvToken });

    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? "unknown";
    const rateLimitKey = `review-ratelimit:${ip}`;
    const alreadySubmitted = await redis.get(rateLimitKey);
    if (alreadySubmitted) {
      res.status(429).json({ error: "Please wait a bit before submitting another review" });
      return;
    }

    const id = crypto.randomUUID();
    const review = {
      id,
      projectId,
      name: name.trim(),
      rating,
      comment: comment.trim(),
      status: "pending" as const,
      createdAt: Date.now(),
    };

    await redis.hset("reviews", { [id]: JSON.stringify(review) });
    await redis.set(rateLimitKey, "1", { ex: RATE_LIMIT_SECONDS });

    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not save review" });
  }
}
