import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis } from "../_lib/redis";
import { getSpotifyAccessToken } from "../_lib/spotifyAuth";

interface SpotifyArtist {
  name: string;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.status(200).json({ isPlaying: false });
    return;
  }

  try {
    const redis = getRedis();
    const accessToken = await getSpotifyAccessToken(redis, clientId, clientSecret);

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
