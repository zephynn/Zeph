# zephyn — link-in-bio portfolio

Frosted-glass link-in-bio site with live Discord presence, a live YouTube
subscriber count, a Spotify "now playing" widget, and a view counter.

## Stack

- Vite + TypeScript, no framework
- `api/youtube.ts` — proxies YouTube Data API v3 so the API key never
  reaches the browser
- [Lanyard](https://github.com/Phineas/lanyard) WebSocket for real-time
  Discord presence (falls back to a single REST call for first paint)
- `api/spotify/*` — OAuth flow + polling proxy for the "now playing" widget
- `api/views.ts` — increments a view counter, backed by Redis
- Upstash Redis (via Vercel's Marketplace integration) for both the view
  counter and the stored Spotify refresh token

## Project structure

```
api/youtube.ts              YouTube subscriber count proxy
api/views.ts                View counter (Redis-backed)
api/spotify/login.ts         Visit once to authorize Spotify (redirects to consent screen)
api/spotify/callback.ts      OAuth callback — exchanges code for a refresh token, stores it
api/spotify/now-playing.ts   Polled by the client for current track
api/_lib/redis.ts            Shared Redis client (reads KV_REST_API_URL/TOKEN)
api/_lib/spotifyAuth.ts       Shared Spotify access-token refresh logic
src/config.ts                Discord ID, YouTube channel ID, Roblox/TikTok links — edit this
src/lib/discord.ts            Lanyard WebSocket client
src/lib/youtube.ts             Client-side polling wrapper around /api/youtube
src/lib/spotify.ts             Client-side polling wrapper around /api/spotify/now-playing
src/lib/views.ts                Client-side fetch wrapper around /api/views
src/lib/color.ts                 Avatar luminance sampling (light/dark text auto-switch)
src/lib/time.ts                   Local-time pill math
src/lib/animate.ts                 Count-up number animation
src/main.ts                        Wires all of the above into the DOM
src/style.css                      Glassmorphism styling (light theme, PFP-derived background)
index.html                          Markup
```

## Setup

1. Edit `src/config.ts`:
   - `roblox.url` — currently a placeholder, set it to your real profile URL
2. Copy `.env.example` to `.env` and fill in the values (see the comments in
   that file — YouTube API key, Redis, Spotify).
3. Install dependencies:

   ```bash
   npm install
   ```

### Spotify "now playing" setup

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. In that app's settings, add a Redirect URI that exactly matches
   `SPOTIFY_REDIRECT_URI` in your `.env`/Vercel env vars (e.g.
   `https://your-domain.vercel.app/api/spotify/callback`) — Spotify requires
   an exact match, no wildcards.
3. Set `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REDIRECT_URI`
   in Vercel's Environment Variables, and deploy.
4. Visit `https://your-domain.vercel.app/api/spotify/login` once, logged into
   your own Spotify account, and grant access. That stores a refresh token in
   Redis — nothing further to do after that; `api/spotify/now-playing.ts`
   handles refreshing the access token on its own from then on.
5. The widget only shows up when something is actually playing (it hides
   itself otherwise, no "nothing playing" state).

## Local development

`npm run dev` only serves the static frontend — the `/api/*` routes won't
resolve without a server for them. For full local testing, install the
Vercel CLI and run:

```bash
npm install -g vercel
vercel dev
```

This reads `.env` and serves both the site and all API routes together on
one port.

Lanyard's presence data is fetched directly from the browser
(`api.lanyard.rest`), no key required — that part works with plain
`npm run dev` too.

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel (vite is auto-detected; `api/` becomes serverless
   functions automatically, no `vercel.json` needed).
3. Add the Upstash integration from Vercel's Marketplace (Storage tab) —
   pick **Redis**, not QStash/Vector/Kafka if those show up too.
4. Set the env vars from `.env.example` in the Vercel project.
5. Deploy, then do the one-time Spotify authorization step above.

## Notes on the sandbox / dev-container testing

This project was built in a sandboxed cloud dev environment whose outbound
network policy only allow-lists a handful of hosts (npm, PyPI, Anthropic,
etc.) — several of the external APIs used here (Lanyard, sometimes Google's
APIs, Spotify, Upstash) are blocked there with a proxy-level 403, before the
request ever reaches the real service. That's an environment restriction,
not a bug in the fetch code. Live behavior should be verified after
deploying to Vercel (or running locally outside a restricted sandbox),
where outbound requests aren't constrained the same way.
