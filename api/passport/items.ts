import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

/**
 * The passport store — a Redis hash "passport": item id → JSON.
 *
 *   GET                         Public. Every item, newest first.
 *   POST { action: "save" }     Password-gated upsert (create or edit).
 *   POST { action: "delete" }   Password-gated delete.
 *
 * Metadata (title, cover URL, etc.) is snapshotted at save time from the
 * admin's chosen search result, so the public page never touches TMDB /
 * AniList / IGDB / iTunes. Cover images are still hotlinked from each
 * provider's CDN — the host allowlist below keeps it to those CDNs only.
 *
 * Self-contained on purpose (no local imports) — see the README.
 */

type PassportType = "movie" | "show" | "anime" | "manga" | "game" | "album" | "song";
type Shelf = "current" | "alltime";

interface PassportItem {
  id: string;
  type: PassportType;
  title: string;
  subtitle: string;
  cover: string;
  url: string;
  note: string;
  shelf: Shelf;
  featured: boolean;
  addedAt: number;
}

const HASH_KEY = "passport";
const TYPES: PassportType[] = ["movie", "show", "anime", "manga", "game", "album", "song"];
const SHELVES: Shelf[] = ["current", "alltime"];
const ID_PATTERN = /^[a-z]+-[A-Za-z0-9_-]{1,40}$/;
const MAX_TITLE = 200;
const MAX_SUBTITLE = 200;
const MAX_NOTE = 1200;
const MAX_URL = 500;

const COVER_HOSTS = ["image.tmdb.org", "s4.anilist.co", "images.igdb.com"];
const isAllowedCoverHost = (host: string) => COVER_HOSTS.includes(host) || host.endsWith(".mzstatic.com");

function isHttpsUrl(value: string, hostCheck?: (host: string) => boolean): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (!hostCheck || hostCheck(url.hostname));
  } catch {
    return false;
  }
}

function parseItems(all: Record<string, unknown> | null): PassportItem[] {
  if (!all) return [];
  return Object.values(all)
    .map((raw) => {
      try {
        return (typeof raw === "string" ? JSON.parse(raw) : raw) as PassportItem;
      } catch {
        return null;
      }
    })
    .filter((item): item is PassportItem => item !== null && typeof item.id === "string");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    if (!kvUrl || !kvToken) {
      res.status(200).json({ items: [] });
      return;
    }
    try {
      const redis = new Redis({ url: kvUrl, token: kvToken });
      const items = parseItems(await redis.hgetall<Record<string, unknown>>(HASH_KEY));
      items.sort((a, b) => b.addedAt - a.addedAt);
      res.status(200).json({ items });
    } catch {
      res.status(200).json({ items: [] });
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
    res.status(500).json({ error: "Passport store is not configured" });
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

  const { id, type, title, subtitle, cover, url, note, shelf, featured } = (body.item ?? {}) as Record<string, unknown>;

  if (
    typeof id !== "string" ||
    !ID_PATTERN.test(id) ||
    typeof type !== "string" ||
    !TYPES.includes(type as PassportType) ||
    typeof title !== "string" ||
    !title.trim() ||
    title.length > MAX_TITLE ||
    typeof subtitle !== "string" ||
    subtitle.length > MAX_SUBTITLE ||
    typeof cover !== "string" ||
    (cover !== "" && !isHttpsUrl(cover, isAllowedCoverHost)) ||
    typeof url !== "string" ||
    url.length > MAX_URL ||
    (url !== "" && !isHttpsUrl(url)) ||
    typeof note !== "string" ||
    !note.trim() ||
    note.length > MAX_NOTE ||
    typeof shelf !== "string" ||
    !SHELVES.includes(shelf as Shelf) ||
    typeof featured !== "boolean"
  ) {
    res.status(400).json({ error: "Invalid item — a note is required, and covers must come from a supported source." });
    return;
  }

  try {
    const existing = parseItems(await redis.hgetall<Record<string, unknown>>(HASH_KEY));
    const previous = existing.find((item) => item.id === id);

    const item: PassportItem = {
      id,
      type: type as PassportType,
      title: title.trim(),
      subtitle: subtitle.trim(),
      cover,
      url,
      note: note.trim(),
      shelf: shelf as Shelf,
      featured,
      // Editing keeps the original "added" date so the ordering stays stable.
      addedAt: previous?.addedAt ?? Date.now(),
    };

    const writes: Record<string, string> = { [id]: JSON.stringify(item) };
    // Only one Obsession at a time — featuring this item un-features the old one.
    if (featured) {
      for (const other of existing) {
        if (other.id !== id && other.featured) writes[other.id] = JSON.stringify({ ...other, featured: false });
      }
    }

    await redis.hset(HASH_KEY, writes);
    res.status(200).json({ ok: true, item });
  } catch {
    res.status(500).json({ error: "Could not save item" });
  }
}
