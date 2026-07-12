# zephyn — link-in-bio portfolio

Frosted-glass link-in-bio site with live Discord presence, a live YouTube
subscriber count, and a view counter.

## Stack

- Vite + TypeScript, no framework
- `api/youtube.ts` — proxies YouTube Data API v3 so the API key never
  reaches the browser
- [Lanyard](https://github.com/Phineas/lanyard) WebSocket for real-time
  Discord presence (falls back to a single REST call for first paint)
- `api/views.ts` — increments a view counter, backed by Redis
- Upstash Redis (via Vercel's Marketplace integration) for the view counter

Each `api/*.ts` function is deliberately self-contained (no shared local
imports between them) — only npm packages. An earlier version shared Redis
logic via `api/_lib/`, but Vercel's Node runtime failed to resolve those
relative imports at runtime (`ERR_MODULE_NOT_FOUND`), so the small amount of
duplication is intentional here, not an oversight.

## Project structure

```
api/youtube.ts        YouTube subscriber count proxy
api/views.ts           View counter (Redis-backed)
src/config.ts           Discord ID, YouTube channel ID, Roblox/TikTok links — edit this
src/lib/discord.ts       Lanyard WebSocket client
src/lib/youtube.ts        Client-side polling wrapper around /api/youtube
src/lib/views.ts           Client-side fetch wrapper around /api/views
src/lib/color.ts            Avatar luminance sampling (light/dark text auto-switch)
src/lib/time.ts               Local-time pill math
src/lib/animate.ts             Count-up number animation
src/main.ts                     Wires all of the above into the DOM
src/style.css                    Glassmorphism styling (light theme, PFP-derived background)
index.html                         Markup
```

## Setup

1. Edit `src/config.ts`:
   - `roblox.url` — currently a placeholder, set it to your real profile URL
2. Copy `.env.example` to `.env` and fill in the values (YouTube API key, Redis).
3. Install dependencies:

   ```bash
   npm install
   ```

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
5. Deploy.

## Notes on the sandbox / dev-container testing

This project was built in a sandboxed cloud dev environment whose outbound
network policy only allow-lists a handful of hosts (npm, PyPI, Anthropic,
etc.) — several of the external APIs used here (Lanyard, sometimes Google's
APIs, Upstash) are blocked there with a proxy-level 403, before the request
ever reaches the real service. That's an environment restriction, not a bug
in the fetch code. Live behavior should be verified after deploying to
Vercel (or running locally outside a restricted sandbox), where outbound
requests aren't constrained the same way.
