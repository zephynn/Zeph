import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 200;
const MAX_DETAIL = 4000;
const MAX_URL = 500;

/** Password-gated upsert (create or update, keyed by slug). */
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
  const { slug, title, description, detail, image, url } = body as Record<string, unknown>;

  if (
    typeof slug !== "string" ||
    !SLUG_PATTERN.test(slug) ||
    typeof title !== "string" ||
    !title.trim() ||
    title.length > MAX_TITLE ||
    typeof description !== "string" ||
    description.length > MAX_DESCRIPTION ||
    typeof detail !== "string" ||
    detail.length > MAX_DETAIL ||
    typeof image !== "string" ||
    typeof url !== "string" ||
    url.length > MAX_URL
  ) {
    res.status(400).json({ error: "Invalid project data" });
    return;
  }

  try {
    const redis = new Redis({ url: kvUrl, token: kvToken });
    const project = {
      slug,
      title: title.trim(),
      description: description.trim(),
      detail: detail.trim(),
      image: image.trim(),
      url: url.trim() || "#",
    };
    await redis.hset("portfolio", { [slug]: JSON.stringify(project) });
    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not save project" });
  }
}
