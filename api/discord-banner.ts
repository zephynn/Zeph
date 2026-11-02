import type { VercelRequest, VercelResponse } from "@vercel/node";

// Hard-coded on purpose: this endpoint only ever looks up the site owner, so
// it can't be used as an open proxy into Discord's API.
const DISCORD_USER_ID = "1491487646424498357";

/**
 * Returns the owner's Discord profile banner URL, or null if they don't have
 * one. Lanyard doesn't expose banners, so this asks Discord directly, which
 * needs a bot token (any bot works — it doesn't have to share a server with
 * the user). Without DISCORD_BOT_TOKEN set this just returns null and the
 * page keeps the blurred-avatar background, so nothing breaks.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    res.setHeader("Cache-Control", "s-maxage=300");
    res.status(200).json({ bannerUrl: null, reason: "not_configured" });
    return;
  }

  try {
    const upstream = await fetch(`https://discord.com/api/v10/users/${DISCORD_USER_ID}`, {
      headers: { Authorization: `Bot ${token}` },
    });

    if (!upstream.ok) {
      // Short cache so a bad token / outage doesn't stick around.
      res.setHeader("Cache-Control", "s-maxage=60");
      res.status(200).json({ bannerUrl: null, reason: `discord_${upstream.status}` });
      return;
    }

    const user = (await upstream.json()) as { banner?: string | null };
    const banner = user.banner;
    const bannerUrl = banner
      ? `https://cdn.discordapp.com/banners/${DISCORD_USER_ID}/${banner}.${banner.startsWith("a_") ? "gif" : "png"}?size=1024`
      : null;

    // Banners rarely change; 10 min at the edge keeps us far from rate limits.
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
    res.status(200).json({ bannerUrl });
  } catch {
    res.setHeader("Cache-Control", "s-maxage=60");
    res.status(200).json({ bannerUrl: null, reason: "fetch_failed" });
  }
}
