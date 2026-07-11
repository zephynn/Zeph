import type { VercelRequest, VercelResponse } from "@vercel/node";

const DEFAULT_CHANNEL_ID = "UCXbuZuNYhCbLk83_uJ3WI_g";

/**
 * Proxies YouTube Data API v3 so the API key stays server-side only.
 * Cached at the edge (s-maxage) since subscriber counts don't need
 * per-request freshness and this keeps us well under API quota.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "YOUTUBE_API_KEY is not configured" });
    return;
  }

  const channelId = typeof req.query.channelId === "string" ? req.query.channelId : DEFAULT_CHANNEL_ID;

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", channelId);
  url.searchParams.set("key", apiKey);

  try {
    const upstream = await fetch(url);
    const json = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: json?.error?.message ?? "YouTube API request failed" });
      return;
    }

    const stats = json.items?.[0]?.statistics;
    if (!stats) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      subscriberCount: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount),
      viewCount: Number(stats.viewCount),
      videoCount: Number(stats.videoCount),
    });
  } catch {
    res.status(502).json({ error: "Could not reach YouTube API" });
  }
}
