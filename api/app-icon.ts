import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Redirects to a Discord application's icon, for activities that send no
 * artwork of their own (otherwise the card would show a grey letter).
 *
 *   GET /api/app-icon?id=<application id>  → 302 to cdn.discordapp.com/app-icons/...
 *                                           → 404 if the app has no icon
 *
 * Uses Discord's public RPC metadata endpoint, which needs no token. Results
 * are cached at the edge for a day, since app icons almost never change.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = typeof req.query.id === "string" ? req.query.id : "";
  // Discord IDs are 17–20 digit snowflakes; rejecting anything else keeps this
  // from being used to make arbitrary requests.
  if (!/^\d{17,20}$/.test(id)) {
    res.status(400).json({ error: "Invalid application id" });
    return;
  }

  try {
    const upstream = await fetch(`https://discord.com/api/v10/applications/${id}/rpc`);
    if (!upstream.ok) {
      res.setHeader("Cache-Control", "s-maxage=3600");
      res.status(404).end();
      return;
    }

    const app = (await upstream.json()) as { icon?: string | null };
    if (!app.icon) {
      res.setHeader("Cache-Control", "s-maxage=86400");
      res.status(404).end();
      return;
    }

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.redirect(302, `https://cdn.discordapp.com/app-icons/${id}/${app.icon}.png?size=128`);
  } catch {
    res.setHeader("Cache-Control", "s-maxage=300");
    res.status(502).end();
  }
}
