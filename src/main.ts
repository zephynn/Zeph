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
    bgLayers[next].style.backgroundImage = `url(${url})`;
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Elements whose text/width depends on the current time, refreshed every second. */
interface LiveTimer {
  update: (now: number) => void;
}
let liveTimers: LiveTimer[] = [];

function buildArt(url: string | null, fallbackLetter: string): HTMLElement {
  if (!url) {
    const placeholder = el("div", "activity__art activity__art--placeholder", fallbackLetter.slice(0, 1).toUpperCase());
    placeholder.setAttribute("aria-hidden", "true");
    return placeholder;
  }
  const img = el("img", "activity__art");
  img.src = url;
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => img.replaceWith(buildArt(null, fallbackLetter)));
  return img;
}

function buildSpotifyCard(spotify: LanyardSpotify): HTMLElement {
  const card = el(spotify.track_id ? "a" : "div", "activity activity--spotify");
  if (card instanceof HTMLAnchorElement && spotify.track_id) {
    card.href = `https://open.spotify.com/track/${spotify.track_id}`;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
  }

  card.appendChild(buildArt(spotify.album_art_url, spotify.song));

  const body = el("div", "activity__body");
  body.appendChild(el("p", "activity__label", "Listening on Spotify"));
  body.appendChild(el("p", "activity__title", spotify.song));
  body.appendChild(el("p", "activity__line", spotify.artist.split(";").join(",")));

  const { start, end } = spotify.timestamps;
  const progress = el("div", "activity__progress");
  const bar = el("div", "activity__bar");
  const fill = el("div", "activity__bar-fill");
  bar.appendChild(fill);
  const elapsed = el("span", "activity__time");
  const total = el("span", "activity__time", formatDuration(end - start));
  progress.append(elapsed, bar, total);
  body.appendChild(progress);

  liveTimers.push({
    update(now) {
      const clamped = Math.min(Math.max(now - start, 0), end - start);
      elapsed.textContent = formatDuration(clamped);
      fill.style.width = `${(clamped / (end - start)) * 100}%`;
    },
  });

  card.appendChild(body);
  return card;
}

function buildActivityCard(activity: LanyardActivity): HTMLElement {
  const card = el("div", "activity");
  card.appendChild(buildArt(activityAssetUrl(activity, activity.assets?.large_image), activity.name));

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
        time.textContent = `${formatDuration(now - start)} elapsed`;
      },
    });
  }

  card.appendChild(body);
  return card;
}

function renderActivities(data: LanyardData) {
  liveTimers = [];
  activitiesEl.replaceChildren();

  const cards: HTMLElement[] = [];
  if (data.listening_to_spotify && data.spotify) cards.push(buildSpotifyCard(data.spotify));

  for (const activity of data.activities) {
    if (activity.type === 4) continue; // custom status → status bubble
    if (activity.type === 2 && activity.name === "Spotify") continue; // covered by the Spotify card
    cards.push(buildActivityCard(activity));
  }

  // Cap it so the profile doesn't turn into a wall of cards.
  activitiesEl.append(...cards.slice(0, 2));
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
