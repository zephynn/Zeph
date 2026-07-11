import type { Redis } from "@upstash/redis";

export const SPOTIFY_REFRESH_TOKEN_KEY = "spotify_refresh_token";

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/**
 * Exchanges the stored refresh token for a fresh access token. Spotify
 * occasionally rotates the refresh token on this call, so we persist the
 * new one when given rather than assuming it stays constant forever.
 */
export async function getSpotifyAccessToken(redis: Redis, clientId: string, clientSecret: string): Promise<string | null> {
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

export { basicAuthHeader };
