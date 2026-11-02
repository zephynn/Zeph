# zephyn — link-in-bio portfolio

Frosted-glass link-in-bio site with live Discord presence, a live YouTube
subscriber count, a view counter, an admin-editable portfolio with
per-project detail pages, and a moderated client review system.

## Stack

- Vite + TypeScript, no framework — 6 pages built as separate Vite entries
  (see `vite.config.ts`), not a single-page app
- `api/youtube.ts` — proxies YouTube Data API v3 so the API key never
  reaches the browser
- [Lanyard](https://github.com/Phineas/lanyard) WebSocket for real-time
  Discord presence (falls back to a single REST call for first paint)
- `api/views.ts` — increments a view counter, backed by Redis
- `api/reviews/*` — review submission (public, rate-limited + honeypot),
  public listing (approved only), and password-gated admin endpoints
- `api/portfolio/*` — public project listing, password-gated create/edit/delete
- Upstash Redis (via Vercel's Marketplace integration) for the view counter,
  reviews (a hash: review id → JSON), and portfolio projects (a hash: slug → JSON)

Each `api/*.ts` function is deliberately self-contained (no shared local
imports between them) — only npm packages, even where that means a little
duplication (e.g. the Redis connection setup, or the admin password check).
An earlier version shared logic via `api/_lib/`, but Vercel's Node runtime
failed to resolve those relative imports at runtime (`ERR_MODULE_NOT_FOUND`),
taking down every function that imported from it — so the duplication here
is intentional, not an oversight.

## Project structure

```
api/youtube.ts                 YouTube subscriber count proxy
api/views.ts                    View counter (Redis-backed)
api/reviews/submit.ts            Public: submit a review (honeypot + per-IP rate limit)
api/reviews/list.ts               Public: list approved reviews, optional ?projectId=
api/reviews/admin-data.ts          Password-gated: every review + read-only view count
api/reviews/moderate.ts              Password-gated: approve or reject a review
api/portfolio/list.ts                 Public: list projects (falls back to 3 placeholders
                                       until you save a real one via /admin)
api/portfolio/save.ts                  Password-gated: create or update a project (by slug)
api/portfolio/delete.ts                 Password-gated: delete a project

src/config.ts                  Discord ID, YouTube channel ID, social links — edit this
src/lib/discord.ts               Lanyard WebSocket client
src/lib/youtube.ts                 Client-side polling wrapper around /api/youtube
src/lib/views.ts                     Client-side fetch wrapper around /api/views
src/lib/reviews.ts                    Client-side fetch/submit wrappers around /api/reviews/*
src/lib/portfolio.ts                   Client-side fetch wrapper around /api/portfolio/list
src/lib/color.ts                         Avatar luminance sampling (light/dark text auto-switch)
src/lib/time.ts                            Local-time pill math
src/lib/animate.ts                           Count-up number animation

src/main.ts        + index.html        Main link-in-bio page
src/portfolio.ts   + portfolio.html     Portfolio grid, cards link to /project/<slug>
src/project.ts     + project.html       Project detail + its reviews + submit form
src/reviews.ts     + reviews.html       Global feed of all approved reviews
src/admin.ts       + admin.html         Password-gated: moderate reviews, manage portfolio
                                        projects, stats + CSV export. Not linked anywhere in
                                        the site nav — you just know the URL (/admin).
src/style.css                          Shared glassmorphism styling for all 6 pages
```

## Setup

1. Edit `src/config.ts`:
   - `roblox.url` — currently a placeholder, set it to your real profile URL
2. Copy `.env.example` to `.env` and fill in the values (YouTube API key,
   Redis, `REVIEWS_ADMIN_PASSWORD`).
3. Install dependencies:

   ```bash
   npm install
   ```
4. Once deployed, go to `/admin`, log in, and add your real projects under
   "Portfolio" — no code edit or redeploy needed for that part anymore.

## Local development

`npm run dev` only serves the static frontend — the `/api/*` routes won't
resolve without a server for them, and neither will the `/project/:slug`
clean URL rewrite (that's Vercel-specific static-file behavior `vite
preview`/`vite dev` don't replicate — locally you'd hit `/project.html`
directly instead). For full local testing, install the Vercel CLI and run:

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
   functions automatically, no extra config needed beyond `vercel.json`,
   which is already checked in for `cleanUrls` + the `/project/:slug` rewrite).
3. Add the Upstash integration from Vercel's Marketplace (Storage tab) —
   pick **Redis**, not QStash/Vector/Kafka if those show up too.
4. Set the env vars from `.env.example` in the Vercel project.
5. Deploy, then go fill in your real portfolio projects at `/admin`.

## Reviews: abuse resistance and moderation

`api/reviews/submit.ts` is the only public write endpoint on the site, so it
has some abuse resistance built in — a honeypot field (`website`, invisible
to real visitors, bots tend to fill in every field) and a 60-second per-IP
cooldown in Redis. Neither is bulletproof, but both cut down on trivial spam
without requiring visitor accounts.

Reviews land as `status: "pending"` and are invisible on the public site
(`api/reviews/list.ts` only ever returns `"approved"` ones) until you approve
them at `/admin`, gated by `REVIEWS_ADMIN_PASSWORD`. That's a shared-secret
gate suitable for a single-admin personal site — there's no lockout or
rate-limit on wrong password attempts, so pick a real password, not something
guessable.

## The admin page (`/admin`)

Not linked anywhere in the site's visible nav — reach it by typing the URL.
Behind the same password gate as reviews:

- **Stats bar**: total/pending/approved review counts, average rating, total
  site views (a read-only Redis peek — it never calls the same `incr()` the
  public view counter uses, so loading admin doesn't inflate your own count),
  and a playful "vibe check" line that reacts to your average rating.
- **Portfolio management**: add, edit, or delete projects — this is now the
  only way to manage portfolio content; `src/config.ts` no longer holds it.
  A project's `slug` is locked once saved (it's the review-tagging key and
  the URL segment), so only new projects get to pick one.
- **CSV export**: downloads every review (any status) as a `.csv`, client-side,
  no extra request.
- **A couple of just-for-fun touches**: a confetti burst when you approve a
  review, and clicking the page title 5 times fast triggers a small joke.
  Both respect `prefers-reduced-motion`.

## Notes on the sandbox / dev-container testing

This project was built in a sandboxed cloud dev environment whose outbound
network policy only allow-lists a handful of hosts (npm, PyPI, Anthropic,
etc.) — several of the external APIs used here (Lanyard, sometimes Google's
APIs, Upstash) are blocked there with a proxy-level 403, before the request
ever reaches the real service. That's an environment restriction, not a bug
in the fetch code. Live behavior should be verified after deploying to
Vercel (or running locally outside a restricted sandbox), where outbound
requests aren't constrained the same way. The review and portfolio API
logic, the client-side rendering (including the XSS-safety of user-submitted
review text), and the full admin flow (stats, CSV export, confetti, the
portfolio add/edit/delete cycle) were all verified locally with mocked API
responses; the real Redis-backed flow and the `/project/:slug` clean-URL
rewrite need checking on an actual Vercel deployment.
