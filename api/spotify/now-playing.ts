import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const SPOTIFY_REFRESH_TOKEN_KEY = "spotify_refresh_token";

interface SpotifyArtist {
  name: string;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/**
 * Exchanges the stored refresh token for a fresh access token. Spotify
 * occasionally rotates the refresh token on this call, so we persist the
 * new one when given rather than assuming it stays constant forever.
 */
async function getAccessToken(redis: Redis, clientId: string, clientSecret: string): Promise<string | null> {
  const refreshToken = await redis.get<string>(SPOTIFY_REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body,
  });

  if (!res.ok) return null;
  const json = await res.json();

  if (typeof json.refresh_token === "string") {
    await redis.set(SPOTIFY_REFRESH_TOKEN_KEY, json.refresh_token);
  }

  return typeof json.access_token === "string" ? json.access_token : null;
}

/**
 * Deliberately self-contained (no local relative imports, duplicated with
 * callback.ts) — Vercel's function build failed to resolve a shared
 * api/_lib/*.ts helper at runtime (ERR_MODULE_NOT_FOUND), so each function
 * only imports npm packages now, which resolve reliably.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!clientId || !clientSecret || !kvUrl || !kvToken) {
    res.status(200).json({ isPlaying: false });
    return;
  }

  try {
    const redis = new Redis({ url: kvUrl, token: kvToken });
    const accessToken = await getAccessToken(redis, clientId, clientSecret);

    if (!accessToken) {
      res.status(200).json({ isPlaying: false });
      return;
    }

    const upstream = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // 204/202: nothing currently playing (not an error — Spotify's documented "no content" response).
    if (upstream.status === 204 || upstream.status === 202 || !upstream.ok) {
      res.status(200).json({ isPlaying: false });
      return;
    }

    const data = await upstream.json();
    const item = data?.item;

    if (!data?.is_playing || !item) {
      res.status(200).json({ isPlaying: false });
      return;
    }

    res.status(200).json({
      isPlaying: true,
      title: item.name as string,
      artist: ((item.artists ?? []) as SpotifyArtist[]).map((a) => a.name).join(", "),
      albumArt: item.album?.images?.[0]?.url ?? null,
      url: item.external_urls?.spotify ?? null,
    });
  } catch {
    res.status(200).json({ isPlaying: false });
  }
}
