import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Password-gated search proxy for the /admin passport picker. One function
 * for every provider (selected by ?type=) so API keys never reach the
 * browser and the deployment doesn't grow by a function per source.
 *
 * Every provider's response is normalised into the same SearchResult shape
 * the admin UI renders — the admin then POSTs the chosen result (plus a
 * note) to api/passport/items.ts, which snapshots it into Redis. The public
 * page never calls this or any third-party API.
 *
 * Self-contained on purpose (no local imports) — see the README.
 */

type PassportType = "movie" | "show" | "anime" | "manga" | "game" | "album" | "song";

interface SearchResult {
  type: PassportType;
  externalId: string;
  title: string;
  subtitle: string;
  cover: string;
  url: string;
}

const TYPES: PassportType[] = ["movie", "show", "anime", "manga", "game", "album", "song"];
const MAX_QUERY = 100;
const LIMIT = 10;

function yearOf(date: unknown): string {
  return typeof date === "string" && /^\d{4}/.test(date) ? date.slice(0, 4) : "";
}

function joinParts(...parts: Array<string | null | undefined>): string {
  return parts.filter((p) => p && p.trim()).join(" · ");
}

// --- TMDB (movies + shows) ---

async function searchTmdb(type: "movie" | "show", query: string): Promise<SearchResult[]> {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not configured");

  const endpoint = type === "movie" ? "movie" : "tv";
  const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");

  // Accept either credential TMDB hands out: the v4 "API Read Access Token"
  // (a JWT, sent as a Bearer header) or the shorter v3 "API Key" (query param).
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB responded ${res.status}`);
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };

  return (data.results ?? []).slice(0, LIMIT).map((r) => {
    const title = String((type === "movie" ? r.title : r.name) ?? "");
    const date = type === "movie" ? r.release_date : r.first_air_date;
    const poster = typeof r.poster_path === "string" ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : "";
    return {
      type,
      externalId: String(r.id),
      title,
      subtitle: yearOf(date),
      cover: poster,
      url: `https://www.themoviedb.org/${endpoint}/${r.id}`,
    };
  });
}

// --- AniList (anime + manga) — public GraphQL, no key ---

const ANILIST_QUERY = `
query ($search: String, $type: MediaType, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, type: $type, isAdult: false, sort: SEARCH_MATCH) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      startDate { year }
      format
      siteUrl
    }
  }
}`;

const ANILIST_FORMAT: Record<string, string> = {
  TV: "TV",
  TV_SHORT: "TV short",
  MOVIE: "Film",
  SPECIAL: "Special",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Music video",
  MANGA: "Manga",
  NOVEL: "Light novel",
  ONE_SHOT: "One-shot",
};

async function searchAniList(type: "anime" | "manga", query: string): Promise<SearchResult[]> {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: ANILIST_QUERY,
      variables: { search: query, type: type === "anime" ? "ANIME" : "MANGA", perPage: LIMIT },
    }),
  });
  if (!res.ok) throw new Error(`AniList responded ${res.status}`);

  interface AniListMedia {
    id: number;
    title: { romaji: string | null; english: string | null };
    coverImage: { extraLarge: string | null; large: string | null };
    startDate: { year: number | null };
    format: string | null;
    siteUrl: string;
  }
  const data = (await res.json()) as { data?: { Page?: { media?: AniListMedia[] } } };

  return (data.data?.Page?.media ?? []).map((m) => ({
    type,
    externalId: String(m.id),
    title: m.title.english || m.title.romaji || "Untitled",
    subtitle: joinParts(m.startDate.year ? String(m.startDate.year) : "", m.format ? ANILIST_FORMAT[m.format] ?? m.format : ""),
    cover: m.coverImage.extraLarge || m.coverImage.large || "",
    url: m.siteUrl,
  }));
}

// --- IGDB (games) — needs a Twitch app's client credentials ---

// Module-scope cache: survives between invocations on a warm instance, so we
// don't mint a new Twitch token for every search. Tokens last ~60 days.
let igdbToken: { value: string; expiresAt: number } | null = null;

async function getIgdbToken(clientId: string, clientSecret: string): Promise<string> {
  if (igdbToken && igdbToken.expiresAt > Date.now() + 60_000) return igdbToken.value;

  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("grant_type", "client_credentials");

  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`Twitch token request responded ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  igdbToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return igdbToken.value;
}

async function searchIgdb(query: string): Promise<SearchResult[]> {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("IGDB_CLIENT_ID / IGDB_CLIENT_SECRET are not configured");

  const token = await getIgdbToken(clientId, clientSecret);
  // IGDB's query language takes the search term as a double-quoted string.
  const safeQuery = query.replace(/["\\]/g, " ");

  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": clientId, Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: `search "${safeQuery}"; fields name,first_release_date,cover.image_id,url,involved_companies.company.name,involved_companies.developer; limit ${LIMIT};`,
  });
  if (res.status === 401) igdbToken = null; // stale token — next search mints a fresh one
  if (!res.ok) throw new Error(`IGDB responded ${res.status}`);

  interface IgdbGame {
    id: number;
    name: string;
    first_release_date?: number;
    cover?: { image_id: string };
    url?: string;
    involved_companies?: Array<{ developer?: boolean; company?: { name?: string } }>;
  }
  const games = (await res.json()) as IgdbGame[];

  return games.map((g) => {
    const year = g.first_release_date ? String(new Date(g.first_release_date * 1000).getUTCFullYear()) : "";
    const developer = g.involved_companies?.find((c) => c.developer)?.company?.name ?? "";
    return {
      type: "game" as const,
      externalId: String(g.id),
      title: g.name,
      subtitle: joinParts(year, developer),
      cover: g.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg` : "",
      url: g.url ?? `https://www.igdb.com/search?q=${encodeURIComponent(g.name)}`,
    };
  });
}

// --- iTunes Search (albums + songs) — public, no key ---

async function searchItunes(type: "album" | "song", query: string): Promise<SearchResult[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", type === "album" ? "album" : "song");
  url.searchParams.set("limit", String(LIMIT));

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`iTunes responded ${res.status}`);
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };

  return (data.results ?? []).map((r) => {
    // artworkUrl100 is a 100px thumbnail, but Apple's CDN serves any size
    // from the same path — swapping the size segment gets a sharp 600px cover.
    const artwork = typeof r.artworkUrl100 === "string" ? r.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x600bb.") : "";
    const isAlbum = type === "album";
    return {
      type,
      externalId: String(isAlbum ? r.collectionId : r.trackId),
      title: String((isAlbum ? r.collectionName : r.trackName) ?? ""),
      subtitle: joinParts(String(r.artistName ?? ""), yearOf(r.releaseDate)),
      cover: artwork,
      url: String((isAlbum ? r.collectionViewUrl : r.trackViewUrl) ?? ""),
    };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Gated so strangers can't burn through the site's API quotas.
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

  const type = String(req.query.type ?? "") as PassportType;
  const query = String(req.query.q ?? "").trim();
  if (!TYPES.includes(type) || !query || query.length > MAX_QUERY) {
    res.status(400).json({ error: "Invalid search" });
    return;
  }

  try {
    let results: SearchResult[];
    if (type === "movie" || type === "show") results = await searchTmdb(type, query);
    else if (type === "anime" || type === "manga") results = await searchAniList(type, query);
    else if (type === "game") results = await searchIgdb(query);
    else results = await searchItunes(type, query);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ results: results.filter((r) => r.title) });
  } catch (error) {
    // The message only ever names which provider/env var failed — no secrets.
    res.status(502).json({ error: error instanceof Error ? error.message : "Search failed" });
  }
}
