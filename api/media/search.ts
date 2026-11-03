import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Password-gated proxy for the /admin Media picker. Two modes, one function
 * (so API keys stay server-side and the deployment doesn't grow by a
 * function per source):
 *
 *   GET ?type=game&q=outer wilds   → { results: SearchResult[] }   (quick list)
 *   GET ?type=game&id=11737        → { item: MediaDetails }         (full info)
 *
 * The admin picks a search result, this fetches its full details, and the
 * admin then POSTs them to api/media/items.ts, which snapshots them into
 * Redis. Visitors never trigger any of these third-party calls.
 *
 * Self-contained on purpose (no local imports) — see the README.
 */

type MediaType = "song" | "game" | "movie" | "show" | "anime" | "manga";

interface SearchResult {
  type: MediaType;
  externalId: string;
  title: string;
  by: string;
  year: string;
  cover: string;
}

interface MediaDetails extends SearchResult {
  url: string;
  overview: string;
  facts: Array<[string, string]>;
}

const TYPES: MediaType[] = ["song", "game", "movie", "show", "anime", "manga"];
const MAX_QUERY = 100;
const LIMIT = 10;

const yearOf = (date: unknown): string => (typeof date === "string" && /^\d{4}/.test(date) ? date.slice(0, 4) : "");

function monthYear(date: unknown): string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}/.test(date)) return yearOf(date);
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Drops empty facts so the detail page never shows a label with no value. */
function facts(...pairs: Array<[string, string | number | null | undefined]>): Array<[string, string]> {
  return pairs
    .map(([label, value]) => [label, value == null ? "" : String(value).trim()] as [string, string])
    .filter(([, value]) => value !== "" && value !== "0");
}

function list(values: Array<string | null | undefined>, max = 3): string {
  return values.filter((v): v is string => !!v && !!v.trim()).slice(0, max).join(", ");
}

async function getJson<T>(url: string | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${new URL(String(url)).hostname} responded ${res.status}`);
  return (await res.json()) as T;
}

// --- TMDB (films + shows) ---

function tmdbRequest(path: string, params: Record<string, string> = {}): [URL, RequestInit] {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not configured");
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // TMDB hands out two credentials: the v4 read token (a JWT, sent as a
  // Bearer header) and the shorter v3 API key (a query param). Accept either.
  const headers: Record<string, string> = {};
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);
  return [url, { headers }];
}

const tmdbPoster = (path: unknown) => (typeof path === "string" ? `https://image.tmdb.org/t/p/w500${path}` : "");

async function searchTmdb(type: "movie" | "show", query: string): Promise<SearchResult[]> {
  const [url, init] = tmdbRequest(`search/${type === "movie" ? "movie" : "tv"}`, { query, include_adult: "false" });
  const data = await getJson<{ results?: Array<Record<string, unknown>> }>(url, init);
  return (data.results ?? []).slice(0, LIMIT).map((r) => ({
    type,
    externalId: String(r.id),
    title: String((type === "movie" ? r.title : r.name) ?? ""),
    by: "",
    year: yearOf(type === "movie" ? r.release_date : r.first_air_date),
    cover: tmdbPoster(r.poster_path),
  }));
}

async function detailTmdb(type: "movie" | "show", id: string): Promise<MediaDetails> {
  type Named = { name: string };
  if (type === "movie") {
    const [url, init] = tmdbRequest(`movie/${id}`, { append_to_response: "credits" });
    const m = await getJson<{
      id: number; title: string; release_date?: string; poster_path?: string; overview?: string; runtime?: number;
      genres?: Named[]; credits?: { crew?: Array<{ job: string; name: string }> };
    }>(url, init);
    const directors = list((m.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name));
    return {
      type, externalId: String(m.id), title: m.title, by: directors, year: yearOf(m.release_date), cover: tmdbPoster(m.poster_path),
      url: `https://www.themoviedb.org/movie/${m.id}`,
      overview: m.overview ?? "",
      facts: facts(
        [directors.includes(",") ? "Directors" : "Director", directors],
        ["Runtime", m.runtime ? formatMinutes(m.runtime) : ""],
        ["Released", monthYear(m.release_date)],
        ["Genres", list((m.genres ?? []).map((g) => g.name))],
      ),
    };
  }

  const [url, init] = tmdbRequest(`tv/${id}`);
  const s = await getJson<{
    id: number; name: string; first_air_date?: string; poster_path?: string; overview?: string;
    number_of_seasons?: number; number_of_episodes?: number; genres?: Named[]; created_by?: Named[]; networks?: Named[];
  }>(url, init);
  const creators = list((s.created_by ?? []).map((c) => c.name));
  return {
    type, externalId: String(s.id), title: s.name, by: creators || s.networks?.[0]?.name || "", year: yearOf(s.first_air_date),
    cover: tmdbPoster(s.poster_path),
    url: `https://www.themoviedb.org/tv/${s.id}`,
    overview: s.overview ?? "",
    facts: facts(
      [creators.includes(",") ? "Creators" : "Creator", creators],
      ["Network", s.networks?.[0]?.name],
      ["Seasons", s.number_of_seasons],
      ["Episodes", s.number_of_episodes],
      ["First aired", monthYear(s.first_air_date)],
      ["Genres", list((s.genres ?? []).map((g) => g.name))],
    ),
  };
}

// --- AniList (anime + manga) — public GraphQL, no key ---

interface AniListMedia {
  id: number;
  title: { romaji: string | null; english: string | null };
  coverImage: { extraLarge: string | null; large: string | null };
  startDate: { year: number | null; month: number | null };
  format?: string | null;
  episodes?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  status?: string | null;
  genres?: string[];
  description?: string | null;
  siteUrl?: string;
  studios?: { nodes: Array<{ name: string }> };
  staff?: { edges: Array<{ role: string; node: { name: { full: string } } }> };
}

async function anilist<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const data = await getJson<{ data?: T; errors?: unknown }>("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!data.data) throw new Error("AniList returned no data");
  return data.data;
}

const aniTitle = (m: AniListMedia) => m.title.english || m.title.romaji || "Untitled";
const aniCover = (m: AniListMedia) => m.coverImage.extraLarge || m.coverImage.large || "";
const titleCase = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "");

function aniCreator(type: "anime" | "manga", m: AniListMedia): string {
  if (type === "anime") return m.studios?.nodes[0]?.name ?? "";
  const edges = m.staff?.edges ?? [];
  return (edges.find((e) => /story/i.test(e.role)) ?? edges[0])?.node.name.full ?? "";
}

/** AniList descriptions contain light HTML (<br>, <i>) and a "(Source: …)" line. Plain text only. */
function cleanDescription(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\(Source:[^)]*\)\s*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function searchAniList(type: "anime" | "manga", query: string): Promise<SearchResult[]> {
  const data = await anilist<{ Page: { media: AniListMedia[] } }>(
    `query ($search: String, $type: MediaType, $perPage: Int) {
      Page(perPage: $perPage) {
        media(search: $search, type: $type, isAdult: false, sort: SEARCH_MATCH) {
          id title { romaji english } coverImage { extraLarge large } startDate { year month }
          studios(isMain: true) { nodes { name } }
          staff(perPage: 3, sort: RELEVANCE) { edges { role node { name { full } } } }
        }
      }
    }`,
    { search: query, type: type === "anime" ? "ANIME" : "MANGA", perPage: LIMIT },
  );
  return data.Page.media.map((m) => ({
    type, externalId: String(m.id), title: aniTitle(m), by: aniCreator(type, m),
    year: m.startDate.year ? String(m.startDate.year) : "", cover: aniCover(m),
  }));
}

async function detailAniList(type: "anime" | "manga", id: string): Promise<MediaDetails> {
  const { Media: m } = await anilist<{ Media: AniListMedia }>(
    `query ($id: Int) {
      Media(id: $id) {
        id title { romaji english } coverImage { extraLarge large } startDate { year month }
        format episodes chapters volumes status genres description(asHtml: false) siteUrl
        studios(isMain: true) { nodes { name } }
        staff(perPage: 3, sort: RELEVANCE) { edges { role node { name { full } } } }
      }
    }`,
    { id: Number(id) },
  );
  const by = aniCreator(type, m);
  const year = m.startDate.year ? String(m.startDate.year) : "";
  return {
    type, externalId: String(m.id), title: aniTitle(m), by, year, cover: aniCover(m),
    url: m.siteUrl ?? `https://anilist.co/${type}/${m.id}`,
    overview: cleanDescription(m.description),
    facts:
      type === "anime"
        ? facts(["Studio", by], ["Format", m.format === "TV" ? "TV" : titleCase(m.format)], ["Episodes", m.episodes], ["Started", year], ["Genres", list(m.genres ?? [])])
        : facts(["Author", by], ["Chapters", m.chapters], ["Volumes", m.volumes], ["Status", titleCase(m.status)], ["Genres", list(m.genres ?? [])]),
  };
}

// --- IGDB (games) — needs a Twitch app's client credentials ---

// Module-scope cache survives between calls on a warm instance, so we don't
// mint a new Twitch token for every search. Tokens last ~60 days.
let igdbToken: { value: string; expiresAt: number } | null = null;

interface IgdbGame {
  id: number;
  name: string;
  first_release_date?: number;
  cover?: { image_id: string };
  url?: string;
  summary?: string;
  genres?: Array<{ name: string }>;
  platforms?: Array<{ abbreviation?: string; name: string }>;
  involved_companies?: Array<{ developer?: boolean; publisher?: boolean; company?: { name?: string } }>;
}

async function igdb(body: string): Promise<IgdbGame[]> {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("IGDB_CLIENT_ID / IGDB_CLIENT_SECRET are not configured");

  if (!igdbToken || igdbToken.expiresAt < Date.now() + 60_000) {
    const tokenUrl = new URL("https://id.twitch.tv/oauth2/token");
    tokenUrl.searchParams.set("client_id", clientId);
    tokenUrl.searchParams.set("client_secret", clientSecret);
    tokenUrl.searchParams.set("grant_type", "client_credentials");
    const t = await getJson<{ access_token: string; expires_in: number }>(tokenUrl, { method: "POST" });
    igdbToken = { value: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  }

  try {
    return await getJson<IgdbGame[]>("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: { "Client-ID": clientId, Authorization: `Bearer ${igdbToken.value}` },
      body,
    });
  } catch (error) {
    igdbToken = null; // possibly a revoked token — the next call mints a fresh one
    throw error;
  }
}

const IGDB_BASE_FIELDS = "name,first_release_date,cover.image_id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher";
const igdbYear = (g: IgdbGame) => (g.first_release_date ? String(new Date(g.first_release_date * 1000).getUTCFullYear()) : "");
const igdbCover = (g: IgdbGame) => (g.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg` : "");
const igdbCompany = (g: IgdbGame, role: "developer" | "publisher") => g.involved_companies?.find((c) => c[role])?.company?.name ?? "";

async function searchIgdb(query: string): Promise<SearchResult[]> {
  // IGDB's query language takes the term as a double-quoted string.
  const games = await igdb(`search "${query.replace(/["\\]/g, " ")}"; fields ${IGDB_BASE_FIELDS}; limit ${LIMIT};`);
  return games.map((g) => ({
    type: "game" as const, externalId: String(g.id), title: g.name, by: igdbCompany(g, "developer"), year: igdbYear(g), cover: igdbCover(g),
  }));
}

async function detailIgdb(id: string): Promise<MediaDetails> {
  if (!/^\d+$/.test(id)) throw new Error("Invalid IGDB id");
  const [g] = await igdb(`where id = ${id}; fields ${IGDB_BASE_FIELDS},url,summary,genres.name,platforms.name,platforms.abbreviation; limit 1;`);
  if (!g) throw new Error("Game not found");
  const developer = igdbCompany(g, "developer");
  const publisher = igdbCompany(g, "publisher");
  const released = g.first_release_date
    ? new Date(g.first_release_date * 1000).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
    : "";
  return {
    type: "game", externalId: String(g.id), title: g.name, by: developer, year: igdbYear(g), cover: igdbCover(g),
    url: g.url ?? `https://www.igdb.com/search?q=${encodeURIComponent(g.name)}`,
    overview: g.summary ?? "",
    facts: facts(
      ["Developer", developer],
      ["Publisher", publisher !== developer ? publisher : ""],
      ["Released", released],
      ["Platforms", list((g.platforms ?? []).map((p) => p.abbreviation || p.name), 5)],
      ["Genres", list((g.genres ?? []).map((x) => x.name))],
    ),
  };
}

// --- iTunes (songs) — public, no key ---

interface ItunesTrack {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

// artworkUrl100 is a 100px thumbnail, but Apple's CDN serves any size from the
// same path — swapping the size segment gets a sharp 600px cover.
const itunesCover = (t: ItunesTrack) => (t.artworkUrl100 ? t.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x600bb.") : "");

function toSongResult(t: ItunesTrack): SearchResult {
  return { type: "song", externalId: String(t.trackId), title: t.trackName, by: t.artistName, year: yearOf(t.releaseDate), cover: itunesCover(t) };
}

async function searchItunes(query: string): Promise<SearchResult[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", String(LIMIT));
  const data = await getJson<{ results?: ItunesTrack[] }>(url);
  return (data.results ?? []).map(toSongResult);
}

async function detailItunes(id: string): Promise<MediaDetails> {
  const url = new URL("https://itunes.apple.com/lookup");
  url.searchParams.set("id", id);
  const data = await getJson<{ results?: ItunesTrack[] }>(url);
  const t = data.results?.[0];
  if (!t) throw new Error("Song not found");
  const seconds = t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : 0;
  return {
    ...toSongResult(t),
    url: t.trackViewUrl ?? "",
    overview: "",
    facts: facts(
      ["Artist", t.artistName],
      ["Album", t.collectionName?.replace(/ - Single$/, "")],
      ["Length", seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""],
      ["Released", yearOf(t.releaseDate)],
      ["Genre", t.primaryGenreName],
    ),
  };
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

  const type = String(req.query.type ?? "") as MediaType;
  const query = String(req.query.q ?? "").trim();
  const id = String(req.query.id ?? "").trim();
  if (!TYPES.includes(type) || (!query && !id) || query.length > MAX_QUERY || !/^[A-Za-z0-9_-]{0,40}$/.test(id)) {
    res.status(400).json({ error: "Invalid search" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  try {
    if (id) {
      let item: MediaDetails;
      if (type === "movie" || type === "show") item = await detailTmdb(type, id);
      else if (type === "anime" || type === "manga") item = await detailAniList(type, id);
      else if (type === "game") item = await detailIgdb(id);
      else item = await detailItunes(id);
      res.status(200).json({ item });
      return;
    }

    let results: SearchResult[];
    if (type === "movie" || type === "show") results = await searchTmdb(type, query);
    else if (type === "anime" || type === "manga") results = await searchAniList(type, query);
    else if (type === "game") results = await searchIgdb(query);
    else results = await searchItunes(query);
    res.status(200).json({ results: results.filter((r) => r.title) });
  } catch (error) {
    // The message only names which provider or env var failed — never secrets.
    res.status(502).json({ error: error instanceof Error ? error.message : "Search failed" });
  }
}
