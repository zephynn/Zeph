import "./style.css";
import "./lib/liquidGlass";
import { config } from "./config";
import {
  createPresenceSource,
  discordAvatarUrl,
  activityAssetUrl,
  avatarDecorationUrl,
  STATUS_LABEL,
  type LanyardData,
  type LanyardActivity,
  type LanyardSpotify,
} from "./lib/discord";
import { watchYoutubeStats, formatCount } from "./lib/youtube";
import { describeLocalTime } from "./lib/time";
import { estimateLuminance } from "./lib/color";
import { animateCount } from "./lib/animate";
import { fetchViewCount } from "./lib/views";

const robloxLink = document.getElementById("card-roblox") as HTMLAnchorElement;
robloxLink.href = config.roblox.url;

const youtubeLink = document.getElementById("card-youtube") as HTMLAnchorElement;
youtubeLink.href = config.youtube.url;

const tiktokLink = document.getElementById("card-tiktok") as HTMLAnchorElement;
tiktokLink.href = config.tiktok.url;

const avatarEl = document.getElementById("discord-avatar") as HTMLImageElement;
const avatarPlaceholderEl = document.getElementById("avatar-placeholder")!;
const bgAvatarEl = document.getElementById("bg-avatar")!;
const statusDotEl = document.getElementById("status-dot")!;
const statusBubbleEl = document.getElementById("status-bubble")!;
const activitiesEl = document.getElementById("activities")!;

// --- Background: blurred pfp ---
// Two stacked layers: the new image loads into the hidden one, then they
// swap opacity, so changing your pfp fades instead of jumping.

const bgLayers = [bgAvatarEl, document.getElementById("bg-avatar-2")!];
let activeBgLayer = 0;
let lastBgUrl = "";

function setBackground(url: string) {
  if (url === lastBgUrl) return;
  lastBgUrl = url;

  // Preload first so the crossfade never fades in a blank layer.
  const img = new Image();
  img.onload = () => {
    if (url !== lastBgUrl) return; // a newer background was requested meanwhile
    const next = 1 - activeBgLayer;
    bgLayers[next].style.setProperty("--bg-image", `url("${url}")`);
    bgLayers[next].classList.add("is-active");
    bgLayers[activeBgLayer].classList.remove("is-active");
    activeBgLayer = next;
    document.body.classList.add("has-avatar-bg");
  };
  img.src = url;

  void estimateLuminance(url).then((luminance) => {
    if (url === lastBgUrl) document.body.classList.toggle("dark-bg-text", luminance < 0.45);
  });
}

function renderBackground(user: LanyardData["discord_user"]) {
  // Larger pfp source for the background blur — blur washes out detail
  // anyway, so a bigger fetch just avoids visible banding once scaled up.
  setBackground(discordAvatarUrl(user, 512));
}

// --- Avatar decoration ---

const decorationEl = document.getElementById("avatar-decoration") as HTMLImageElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

decorationEl.addEventListener("error", () => {
  decorationEl.hidden = true;
});

function renderDecoration(user: LanyardData["discord_user"]) {
  const url = avatarDecorationUrl(user, !reducedMotion.matches);
  if (!url) {
    decorationEl.hidden = true;
    decorationEl.removeAttribute("src");
    return;
  }
  if (decorationEl.getAttribute("src") !== url) decorationEl.src = url;
  decorationEl.hidden = false;
}

// --- Custom status bubble (the "speech bubble" next to the avatar) ---

function renderStatusBubble(activities: LanyardActivity[]) {
  statusBubbleEl.replaceChildren();

  const custom = activities.find((a) => a.type === 4);
  const emoji = custom?.emoji;
  const text = custom?.state ?? "";

  if (emoji?.id) {
    const img = document.createElement("img");
    img.src = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}`;
    img.alt = "";
    img.className = "status-emoji";
    statusBubbleEl.appendChild(img);
  } else if (emoji?.name) {
    statusBubbleEl.appendChild(document.createTextNode(`${emoji.name} `));
  }
  if (text) statusBubbleEl.appendChild(document.createTextNode(text));

  statusBubbleEl.hidden = !text && !emoji;
}

// --- Activity cards (Spotify, games, apps) ---

const ACTIVITY_VERB: Record<number, string> = {
  0: "Playing",
  1: "Streaming",
  2: "Listening to",
  3: "Watching",
  5: "Competing in",
};

const SVG_NS = "http://www.w3.org/2000/svg";
const SPOTIFY_PATH =
  "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.21c3.81-.87 7.08-.5 9.72 1.11.3.18.39.57.21.86Zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.37.22.48.7.26 1.07Zm.1-2.83C14.7 8.94 9.37 8.76 6.3 9.7a.94.94 0 1 1-.54-1.8c3.53-1.07 9.4-.86 13.1 1.33a.94.94 0 0 1-.95 1.62Z";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function spotifyIcon(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", SPOTIFY_PATH);
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

/** Track position, e.g. "3:07" or "1:02:45". */
function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** How long an activity has run, e.g. "for 12m" or "for 1h 6m". */
function formatElapsed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just started";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `for ${m}m`;
  return m === 0 ? `for ${h}h` : `for ${h}h ${m}m`;
}

/** Elements whose text/width depends on the current time, refreshed every second. */
interface LiveTimer {
  update: (now: number) => void;
}
let liveTimers: LiveTimer[] = [];

/**
 * Artwork with fallbacks: tries each URL in turn (e.g. the activity's own
 * image, then the app's icon), and ends on a lettered tile if none load.
 */
function buildArt(urls: (string | null | undefined)[], fallbackLetter: string): HTMLElement {
  const candidates = urls.filter((u): u is string => Boolean(u));
  const placeholder = () => {
    const tile = el("div", "activity__art activity__art--placeholder", fallbackLetter.slice(0, 1).toUpperCase());
    tile.setAttribute("aria-hidden", "true");
    return tile;
  };
  if (candidates.length === 0) return placeholder();

  const img = el("img", "activity__art");
  img.alt = "";
  img.decoding = "async";
  let index = 0;
  img.addEventListener("error", () => {
    index += 1;
    if (index < candidates.length) img.src = candidates[index];
    else img.replaceWith(placeholder());
  });
  img.src = candidates[0];
  return img;
}

/** Decorative equaliser bars. Spotify doesn't expose the audio, so this isn't
 *  reacting to the actual song — it's a "something's playing" indicator. */
function buildVisualiser(): HTMLElement {
  const bars = el("span", "visualiser");
  bars.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 4; i++) bars.appendChild(el("span", "visualiser__bar"));
  return bars;
}

function buildSpotifyCard(spotify: LanyardSpotify): HTMLElement {
  const card = el("div", "activity activity--spotify");
  card.appendChild(buildArt([spotify.album_art_url], spotify.song));

  const body = el("div", "activity__body");

  const label = el("p", "activity__label");
  label.append(spotifyIcon("activity__label-icon"), "Listening on Spotify", buildVisualiser());
  body.appendChild(label);

  body.appendChild(el("p", "activity__title", spotify.song));
  const artist = spotify.artist.split(";").join(",");
  const byline = spotify.album && spotify.album !== spotify.song ? `${artist} · ${spotify.album}` : artist;
  body.appendChild(el("p", "activity__line", byline));

  const { start, end } = spotify.timestamps;
  const length = Math.max(end - start, 1);
  const progress = el("div", "activity__progress");
  const bar = el("div", "activity__bar");
  const fill = el("div", "activity__bar-fill");
  bar.appendChild(fill);
  const elapsed = el("span", "activity__time");
  const total = el("span", "activity__time", formatClock(length));
  progress.append(elapsed, bar, total);
  body.appendChild(progress);

  liveTimers.push({
    update(now) {
      const position = Math.min(Math.max(now - start, 0), length);
      elapsed.textContent = formatClock(position);
      fill.style.width = `${(position / length) * 100}%`;
    },
  });

  if (spotify.track_id) {
    const listen = el("a", "activity__action");
    listen.href = `https://open.spotify.com/track/${spotify.track_id}`;
    listen.target = "_blank";
    listen.rel = "noopener noreferrer";
    listen.append(spotifyIcon("activity__action-icon"), "Listen on Spotify");
    body.appendChild(listen);
  }

  card.appendChild(body);
  return card;
}

function buildActivityCard(activity: LanyardActivity): HTMLElement {
  const card = el("div", "activity");
  const appIcon = activity.application_id ? `/api/app-icon?id=${activity.application_id}` : null;
  card.appendChild(buildArt([activityAssetUrl(activity, activity.assets?.large_image), appIcon], activity.name));

  const body = el("div", "activity__body");
  body.appendChild(el("p", "activity__label", ACTIVITY_VERB[activity.type] ?? "Using"));
  body.appendChild(el("p", "activity__title", activity.name));
  if (activity.details) body.appendChild(el("p", "activity__line", activity.details));
  if (activity.state) body.appendChild(el("p", "activity__line", activity.state));

  const start = activity.timestamps?.start;
  if (start) {
    const time = el("p", "activity__line activity__elapsed");
    body.appendChild(time);
    liveTimers.push({
      update(now) {
        time.textContent = formatElapsed(now - start);
      },
    });
  }

  card.appendChild(body);
  return card;
}

// Discord re-sends presence for unrelated reasons (status changes, other
// fields). Rebuilding identical cards would reload their images and blink,
// so only rebuild when the activity content actually changed.
let lastActivitiesKey = "";

function renderActivities(data: LanyardData) {
  const spotify = data.listening_to_spotify ? data.spotify : null;
  const others = data.activities.filter(
    (a) => a.type !== 4 && !(a.type === 2 && a.name === "Spotify"), // custom status → bubble; Spotify → its own card
  );

  const key = JSON.stringify([spotify, others]);
  if (key === lastActivitiesKey) return;
  lastActivitiesKey = key;

  liveTimers = [];
  const cards: HTMLElement[] = [];
  if (spotify) cards.push(buildSpotifyCard(spotify));
  for (const activity of others) cards.push(buildActivityCard(activity));

  // Cap it so the profile doesn't turn into a wall of cards.
  activitiesEl.replaceChildren(...cards.slice(0, 2));
  activitiesEl.hidden = cards.length === 0;
  tickTimers();
}

function tickTimers() {
  const now = Date.now();
  for (const timer of liveTimers) timer.update(now);
}
window.setInterval(tickTimers, 1000);

// --- Discord presence ---

function renderDiscord(data: LanyardData) {
  avatarEl.src = discordAvatarUrl(data.discord_user, 128);
  avatarEl.alt = data.discord_user.global_name || data.discord_user.username;
  avatarEl.classList.remove("is-hidden");
  avatarPlaceholderEl.classList.add("is-hidden");

  renderBackground(data.discord_user);
  renderDecoration(data.discord_user);

  statusDotEl.dataset.status = data.discord_status;
  statusDotEl.setAttribute("aria-label", `Discord status: ${STATUS_LABEL[data.discord_status]}`);
  document.body.classList.toggle("is-offline", data.discord_status === "offline");

  renderStatusBubble(data.activities);
  renderActivities(data);
}

avatarEl.addEventListener("error", () => {
  avatarEl.classList.add("is-hidden");
  avatarPlaceholderEl.classList.remove("is-hidden");
});

const presence = createPresenceSource(config.discord.userId, config.discord.presenceUrl);
presence.onUpdate(renderDiscord);
void presence.start();

// --- Pills ---

const followersCountEl = document.getElementById("followers-count")!;
watchYoutubeStats((stats) => {
  if (stats.subscriberCount === null) {
    followersCountEl.textContent = "Hidden";
    return;
  }
  animateCount(followersCountEl, stats.subscriberCount, formatCount);
});

const localTimeEl = document.getElementById("local-time")!;
const timeOffsetEl = document.getElementById("time-offset")!;

function renderLocalTime() {
  const { time, offsetLabel } = describeLocalTime(config.timezone);
  localTimeEl.textContent = time;
  timeOffsetEl.textContent = offsetLabel;
}

renderLocalTime();
window.setInterval(renderLocalTime, 30_000);

// The view pill is gone from the page, but the visit is still counted so the
// number on /admin keeps going up.
void fetchViewCount();
