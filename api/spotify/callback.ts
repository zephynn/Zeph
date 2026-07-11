import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const SPOTIFY_REFRESH_TOKEN_KEY = "spotify_refresh_token";

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/**
 * Spotify redirects here after you grant consent at /api/spotify/login,
 * with a one-time `code`. Exchange it for a refresh token and store that
 * in Redis — everything after this point (api/spotify/now-playing) uses
 * the stored refresh token, not this code.
 *
 * Deliberately self-contained (no local relative imports, duplicated with
 * now-playing.ts) — Vercel's function build failed to resolve a shared
 * api/_lib/*.ts helper at runtime (ERR_MODULE_NOT_FOUND), so each function
 * only imports npm packages now, which resolve reliably.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!clientId || !clientSecret || !redirectUri || !kvUrl || !kvToken) {
    res.status(500).send("Spotify OAuth or the Redis store is not configured.");
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const error = typeof req.query.error === "string" ? req.query.error : undefined;

  if (error) {
    res.status(400).send(`Spotify authorization failed: ${error}`);
    return;
  }
  if (!code) {
    res.status(400).send("Missing authorization code.");
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(clientId, clientSecret),
      },
      body,
    });

    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok || typeof tokenJson.refresh_token !== "string") {
      res.status(502).send(`Failed to exchange authorization code: ${tokenJson?.error_description ?? "unknown error"}`);
      return;
    }

    const redis = new Redis({ url: kvUrl, token: kvToken });
    await redis.set(SPOTIFY_REFRESH_TOKEN_KEY, tokenJson.refresh_token);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send("<p>Spotify connected — you can close this tab.</p>");
  } catch {
    res.status(500).send("Could not reach Spotify or the token store.");
  }
}
