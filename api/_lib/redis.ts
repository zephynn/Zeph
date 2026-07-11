import { Redis } from "@upstash/redis";

/**
 * The Vercel Marketplace "Upstash" integration provisions the legacy Vercel
 * KV env var names (KV_REST_API_URL / KV_REST_API_TOKEN), not
 * UPSTASH_REDIS_REST_URL/TOKEN, so we read those explicitly.
 */
export function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("missing KV_REST_API_URL/TOKEN");
  return new Redis({ url, token });
}
