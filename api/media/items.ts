import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

/**
 * The Media store — a Redis hash "media": item id → JSON.
 *
 *   GET                         Public. Every item, newest first.
 *   GET ?id=game-11737          Public. One item (for /media/<id>).
 *   POST { action: "save" }     Password-gated upsert (create or edit).
 *   POST { action: "delete" }   Password-gated delete.
 *
 * Everything shown publicly (title, cover URL, overview, facts) is
 * snapshotted here at save time from api/media/search.ts, so visitors never
 * hit TMDB / AniList / IGDB / iTunes. Cover images are still hotlinked from
 * each provider's CDN — the host allowlist below keeps it to those CDNs.
 *
 * Self-contained on purpose (no local imports) — see the README.
 */

type MediaType = "song" | "game" | "movie" | "show" | "anime" | "manga";

interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  by: string;
  year: string;
  cover: string;
  url: string;
  overview: string;
  facts: Array<[string, string]>;
  note: string;
  rating: number; // 0 = not rated, otherwise 1–5 whole stars
  favourite: boolean;
  preview: string; // songs only: Apple's 30-second preview clip, else ""
  addedAt: number;
}

const HASH_KEY = "media";
const TYPES: MediaType[] = ["song", "game", "movie", "show", "anime", "manga"];
const ID_PATTERN = /^[a-z]+-[A-Za-z0-9_-]{1,40}$/;
const MAX = { title: 200, by: 200, url: 500, overview: 3000, note: 1500, facts: 8, factLabel: 30, factValue: 200 };

const COVER_HOSTS = ["image.tmdb.org", "s4.anilist.co", "images.igdb.com"];
const isAllowedCoverHost = (host: string) => COVER_HOSTS.includes(host) || host.endsWith(".mzstatic.com");
// Apple serves preview clips from audio-ssl.itunes.apple.com (and occasionally mzstatic).
const isAllowedPreviewHost = (host: string) => host.endsWith(".itunes.apple.com") || host.endsWith(".mzstatic.com");

function isHttpsUrl(value: string, hostCheck?: (host: string) => boolean): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (!hostCheck || hostCheck(url.hostname));
  } catch {
    return false;
  }
}

const isString = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

function isFacts(v: unknown): v is Array<[string, string]> {
  return (
    Array.isArray(v) &&
    v.length <= MAX.facts &&
    v.every((f) => Array.isArray(f) && f.length === 2 && isString(f[0], MAX.factLabel) && isString(f[1], MAX.factValue))
  );
}

function parseItems(all: Record<string, unknown> | null): MediaItem[] {
  if (!all) return [];
  return Object.values(all)
    .map((raw) => {
      try {
        return (typeof raw === "string" ? JSON.parse(raw) : raw) as MediaItem;
      } catch {
        return null;
      }
    })
    .filter((item): item is MediaItem => item !== null && typeof item.id === "string");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    const id = typeof req.query.id === "string" ? req.query.id : "";
    if (!kvUrl || !kvToken) {
      res.status(id ? 404 : 200).json(id ? { error: "Not found" } : { items: [] });
      return;
    }
    try {
      const redis = new Redis({ url: kvUrl, token: kvToken });
      if (id) {
        const raw = ID_PATTERN.test(id) ? await redis.hget<unknown>(HASH_KEY, id) : null;
        const [item] = parseItems(raw ? { [id]: raw } : null);
        if (item) res.status(200).json({ item });
        else res.status(404).json({ error: "Not found" });
        return;
      }
      const items = parseItems(await redis.hgetall<Record<string, unknown>>(HASH_KEY));
      items.sort((a, b) => b.addedAt - a.addedAt);
      res.status(200).json({ items });
    } catch {
      res.status(id ? 500 : 200).json(id ? { error: "Could not load item" } : { items: [] });
    }
    return;
  }

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
  if (!kvUrl || !kvToken) {
    res.status(500).json({ error: "Media store is not configured" });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const redis = new Redis({ url: kvUrl, token: kvToken });

  if (body.action === "delete") {
    if (typeof body.id !== "string" || !ID_PATTERN.test(body.id)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      await redis.hdel(HASH_KEY, body.id);
      res.status(200).json({ ok: true });
    } catch {
      res.status(500).json({ error: "Could not delete item" });
    }
    return;
  }

  if (body.action !== "save") {
    res.status(400).json({ error: "Unknown action" });
    return;
  }

  const i = (body.item ?? {}) as Record<string, unknown>;
  i.preview ??= ""; // optional; older admin pages don't send it
  if (
    !isString(i.id, 60) || !ID_PATTERN.test(i.id) ||
    typeof i.type !== "string" || !TYPES.includes(i.type as MediaType) || !i.id.startsWith(`${i.type}-`) ||
    !isString(i.title, MAX.title) || !i.title.trim() ||
    !isString(i.by, MAX.by) ||
    !isString(i.year, 4) || !/^(\d{4})?$/.test(i.year) ||
    !isString(i.cover, MAX.url) || (i.cover !== "" && !isHttpsUrl(i.cover, isAllowedCoverHost)) ||
    !isString(i.url, MAX.url) || (i.url !== "" && !isHttpsUrl(i.url)) ||
    !isString(i.overview, MAX.overview) ||
    !isFacts(i.facts) ||
    !isString(i.note, MAX.note) ||
    typeof i.rating !== "number" || !Number.isInteger(i.rating) || i.rating < 0 || i.rating > 5 ||
    typeof i.favourite !== "boolean" ||
    !isString(i.preview, MAX.url) || (i.preview !== "" && (i.type !== "song" || !isHttpsUrl(i.preview, isAllowedPreviewHost)))
  ) {
    res.status(400).json({ error: "Invalid item. Covers must come from a supported source and ratings are 0–5 whole stars." });
    return;
  }

  try {
    const existingRaw = await redis.hget<unknown>(HASH_KEY, i.id);
    const [previous] = parseItems(existingRaw ? { [i.id]: existingRaw } : null);
    const item: MediaItem = {
      id: i.id,
      type: i.type as MediaType,
      title: i.title.trim(),
      by: i.by.trim(),
      year: i.year,
      cover: i.cover,
      url: i.url,
      overview: i.overview.trim(),
      facts: i.facts.map(([label, value]) => [label.trim(), value.trim()] as [string, string]).filter(([l, v]) => l && v),
      note: i.note.trim(),
      rating: i.rating,
      favourite: i.favourite,
      preview: i.preview,
      // Editing keeps the original "added" date so row order stays stable.
      addedAt: previous?.addedAt ?? Date.now(),
    };
    await redis.hset(HASH_KEY, { [item.id]: JSON.stringify(item) });
    res.status(200).json({ ok: true, item });
  } catch {
    res.status(500).json({ error: "Could not save item" });
  }
}
