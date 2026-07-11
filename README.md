# zephyn — link-in-bio portfolio

Frosted-glass link-in-bio site with live Discord presence and a live YouTube
subscriber count.

## Stack

- Vite + TypeScript, no framework
- `api/youtube.ts` — Vercel serverless function that proxies the YouTube Data
  API v3 so the API key never reaches the browser
- [Lanyard](https://github.com/Phineas/lanyard) WebSocket for real-time
  Discord presence (falls back to a single REST call for first paint)

## Project structure

```
api/youtube.ts        Vercel serverless function (YouTube proxy)
src/config.ts         Discord ID, YouTube channel ID, Roblox link — edit this
src/lib/discord.ts     Lanyard WebSocket client
src/lib/youtube.ts     Client-side polling wrapper around /api/youtube
src/main.ts            Wires data into the DOM
src/style.css          Glassmorphism styling (light theme, background blobs)
index.html              Markup
```

## Setup

1. Edit `src/config.ts`:
   - `roblox.url` — currently a placeholder, set it to your real profile URL
   - `discordInvite` — optional, if you want the Discord card to link somewhere
2. Copy `.env.example` to `.env` and set `YOUTUBE_API_KEY` (see the comment in
   that file for how to get one).
3. Install dependencies:

   ```bash
   npm install
   ```

## Local development

`npm run dev` only serves the static frontend — `/api/youtube` won't resolve
without a server for it. For full local testing (frontend + serverless
function), install the Vercel CLI and run:

```bash
npm install -g vercel
vercel dev
```

This reads `.env`/`YOUTUBE_API_KEY` and serves both the site and the API
route together on one port.

Lanyard's presence data is fetched directly from the browser (`api.lanyard.rest`),
no key required — that part works with plain `npm run dev` too.

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel (vite is auto-detected; `api/` becomes a serverless
   function automatically, no `vercel.json` needed).
3. In the Vercel project's Environment Variables, set `YOUTUBE_API_KEY`.
4. Deploy.

## Notes on the sandbox / dev-container testing

This project was built in a sandboxed cloud dev environment whose outbound
network policy only allow-lists a handful of hosts (npm, PyPI, Anthropic,
etc.) — `api.lanyard.rest` and `googleapis.com` are both blocked there with a
proxy-level 403, before the request ever reaches Discord or Google. That's
why an earlier single-file preview showed "unavailable": it's an environment
restriction, not a bug in the fetch code. Both integrations should be
verified after deploying to Vercel (or running locally outside a restricted
sandbox), where outbound requests aren't constrained the same way.
