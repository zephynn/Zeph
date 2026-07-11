import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis } from "../_lib/redis";
import { SPOTIFY_REFRESH_TOKEN_KEY, basicAuthHeader } from "../_lib/spotifyAuth";

/**
 * Spotify redirects here after you grant consent at /api/spotify/login,
 * with a one-time `code`. Exchange it for a refresh token and store that
 * in Redis — everything after this point (api/spotify/now-playing) uses
 * the stored refresh token, not this code.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send("Spotify OAuth is not configured.");
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

    await getRedis().set(SPOTIFY_REFRESH_TOKEN_KEY, tokenJson.refresh_token);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send("<p>Spotify connected — you can close this tab.</p>");
  } catch {
    res.status(500).send("Could not reach Spotify or the token store.");
  }
}
