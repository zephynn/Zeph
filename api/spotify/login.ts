import type { VercelRequest, VercelResponse } from "@vercel/node";

const SCOPES = "user-read-currently-playing user-read-playback-state";

/**
 * Visit this once (logged into your own Spotify account) to grant the app
 * permission — it redirects to Spotify's consent screen, which redirects
 * back to /api/spotify/callback with a code we exchange for a refresh token.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.status(500).send("Spotify OAuth is not configured (missing SPOTIFY_CLIENT_ID/SPOTIFY_REDIRECT_URI).");
    return;
  }

  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);

  res.redirect(302, url.toString());
}
