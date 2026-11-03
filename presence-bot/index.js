// zephyn presence bot — a small self-hosted replacement for Lanyard.
//
// Stays connected to the Discord gateway, watches one user's presence, and
// serves it over HTTP in the same JSON shape Lanyard uses, so the site's
// activity cards work unchanged:
//
//   GET /v1/presence  → { success: true, data: <presence> }   (one-off snapshot)
//   GET /v1/stream    → Server-Sent Events, an "presence" event on every change
//   GET /health       → 200 "ok"
//
// Required env:
//   DISCORD_BOT_TOKEN  bot token (Developer Portal → Bot → Reset Token)
//   DISCORD_USER_ID    whose presence to serve
// Optional env:
//   PORT               default 3000
//   HOST               interface to listen on; default 0.0.0.0. The Google
//                      Cloud setup uses 127.0.0.1, with Caddy in front for HTTPS.

import http from "node:http";
import { ActivityType, Client, Events, GatewayIntentBits } from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const USER_ID = process.env.DISCORD_USER_ID;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Each open tab holds one SSE connection; cap them so a flood of connections
// can't exhaust the container.
const MAX_STREAM_CLIENTS = 500;
const KEEPALIVE_MS = 25_000;

if (!TOKEN || !USER_ID) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_USER_ID environment variable.");
  process.exit(1);
}

// --- Presence → Lanyard-shaped JSON ---

const ms = (date) => (date ? date.getTime() : undefined);

function serializeActivity(activity) {
  const assets = activity.assets;
  return {
    id: activity.id ?? activity.name,
    name: activity.name,
    type: activity.type,
    state: activity.state ?? undefined,
    details: activity.details ?? undefined,
    application_id: activity.applicationId ?? undefined,
    timestamps: activity.timestamps
      ? { start: ms(activity.timestamps.start), end: ms(activity.timestamps.end) }
      : undefined,
    assets: assets
      ? {
          large_image: assets.largeImage ?? undefined,
          large_text: assets.largeText ?? undefined,
          small_image: assets.smallImage ?? undefined,
          small_text: assets.smallText ?? undefined,
        }
      : undefined,
    emoji: activity.emoji
      ? { name: activity.emoji.name, id: activity.emoji.id ?? undefined, animated: activity.emoji.animated ?? false }
      : undefined,
  };
}

function buildSpotify(activities) {
  const track = activities.find(
    (a) => a.type === ActivityType.Listening && a.name === "Spotify" && a.syncId,
  );
  if (!track) return null;

  const art = track.assets?.largeImage;
  return {
    track_id: track.syncId,
    song: track.details ?? "",
    artist: track.state ?? "",
    album: track.assets?.largeText ?? "",
    album_art_url: art?.startsWith("spotify:") ? `https://i.scdn.co/image/${art.slice(8)}` : null,
    timestamps: { start: ms(track.timestamps?.start) ?? 0, end: ms(track.timestamps?.end) ?? 0 },
  };
}

function buildPresence(user, presence) {
  const activities = presence?.activities ?? [];
  const clients = presence?.clientStatus ?? {};
  const spotify = buildSpotify(activities);

  return {
    discord_user: {
      id: user.id,
      username: user.username,
      global_name: user.globalName ?? null,
      discriminator: user.discriminator,
      avatar: user.avatar,
    },
    // No presence object at all means Discord considers the user offline
    // (or invisible — Discord deliberately reports those the same way).
    discord_status: presence?.status ?? "offline",
    activities: activities.map(serializeActivity),
    listening_to_spotify: spotify !== null,
    spotify,
    active_on_discord_desktop: Boolean(clients.desktop),
    active_on_discord_mobile: Boolean(clients.mobile),
    active_on_discord_web: Boolean(clients.web),
  };
}

// --- State + SSE broadcast ---

let current = null; // last presence payload, null until the bot has found the user
let currentJson = "";
const streamClients = new Set();

function publish(payload) {
  const json = JSON.stringify(payload);
  if (json === currentJson) return; // Discord sometimes re-sends identical presences
  current = payload;
  currentJson = json;
  for (const res of streamClients) res.write(`event: presence\ndata: ${json}\n\n`);
}

// --- Discord client ---

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences],
});

async function loadInitialPresence() {
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch({ user: USER_ID, withPresences: true, force: true });
      publish(buildPresence(member.user, member.presence));
      console.log(`Tracking ${member.user.username} via server "${guild.name}".`);
      return;
    } catch {
      // Not in this server — try the next one.
    }
  }
  console.warn(
    `User ${USER_ID} isn't in any server with this bot. Invite the bot to a server you're in ` +
      "(and make sure Presence + Server Members intents are enabled in the Developer Portal).",
  );
}

client.once(Events.ClientReady, async (ready) => {
  console.log(`Logged in as ${ready.user.tag}, in ${ready.guilds.cache.size} server(s).`);
  await loadInitialPresence();
});

client.on(Events.PresenceUpdate, (_old, presence) => {
  if (presence.userId !== USER_ID) return;
  const user = presence.user ?? presence.member?.user;
  if (user) publish(buildPresence(user, presence));
});

// Avatar / username changes.
client.on(Events.UserUpdate, (_old, user) => {
  if (user.id !== USER_ID || !current) return;
  const member = client.guilds.cache.find((g) => g.members.cache.has(USER_ID))?.members.cache.get(USER_ID);
  publish(buildPresence(user, member?.presence ?? null));
});

// Bot was just added to a server — the user might be in it.
client.on(Events.GuildCreate, () => {
  if (!current) void loadInitialPresence();
});

// --- HTTP server ---

function sendCors(res) {
  // Presence is public by design (it's shown on a public website), so any
  // origin may read it — same policy as Lanyard.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

const server = http.createServer((req, res) => {
  sendCors(res);
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }

  if (url.pathname === "/v1/presence") {
    res.setHeader("Cache-Control", "no-store");
    if (!current) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { message: "Presence not available yet" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(`{"success":true,"data":${currentJson}}`);
    return;
  }

  if (url.pathname === "/v1/stream") {
    if (streamClients.size >= MAX_STREAM_CLIENTS) {
      res.writeHead(503).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // Stop proxies from buffering the stream.
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 5000\n\n");
    if (current) res.write(`event: presence\ndata: ${currentJson}\n\n`);

    streamClients.add(res);
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), KEEPALIVE_MS);
    req.on("close", () => {
      clearInterval(keepalive);
      streamClients.delete(res);
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, HOST, () => console.log(`HTTP listening on ${HOST}:${PORT}`));

client.login(TOKEN).catch((err) => {
  console.error("Discord login failed:", err.message);
  process.exit(1);
});

// systemd sends SIGTERM on restart/stop.
process.on("SIGTERM", () => {
  for (const res of streamClients) res.end();
  server.close();
  void client.destroy();
  process.exit(0);
});
