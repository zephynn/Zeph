import "./style.css";
import { config } from "./config";
import { LanyardClient, discordAvatarUrl, STATUS_LABEL, type LanyardData, type LanyardActivity } from "./lib/discord";
import { watchYoutubeStats, formatCount } from "./lib/youtube";
import { describeLocalTime } from "./lib/time";
import { estimateLuminance } from "./lib/color";
import { animateCount } from "./lib/animate";
import { fetchViewCount } from "./lib/views";
import { watchNowPlaying } from "./lib/spotify";

const yearEl = document.getElementById("year")!;
yearEl.textContent = String(new Date().getFullYear());

const robloxLink = document.getElementById("card-roblox") as HTMLAnchorElement;
robloxLink.href = config.roblox.url;

const youtubeLink = document.getElementById("card-youtube") as HTMLAnchorElement;
youtubeLink.href = config.youtube.url;

const tiktokLink = document.getElementById("card-tiktok") as HTMLAnchorElement;
tiktokLink.href = config.tiktok.url;

const handlesEl = document.getElementById("handles")!;
handlesEl.textContent = `(${config.handles.map((h) => `@${h}`).join(" / ")})`;

const avatarEl = document.getElementById("discord-avatar") as HTMLImageElement;
const avatarPlaceholderEl = document.getElementById("avatar-placeholder")!;
const bgAvatarEl = document.getElementById("bg-avatar")!;
const statusDotEl = document.getElementById("status-dot")!;
const statusBubbleEl = document.getElementById("status-bubble")!;

const ACTIVITY_VERB: Record<number, string> = {
  0: "Playing",
  1: "Streaming",
  2: "Listening to",
  3: "Watching",
  5: "Competing in",
};

interface ActivityContent {
  emojiUrl?: string;
  emojiUnicode?: string;
  text: string;
}

function getActivityContent(activities: LanyardActivity[]): ActivityContent | null {
  const custom = activities.find((a) => a.type === 4);
  if (custom?.state || custom?.emoji) {
    const emoji = custom.emoji;
    return {
      emojiUrl: emoji?.id ? `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}` : undefined,
      emojiUnicode: emoji && !emoji.id ? emoji.name : undefined,
      text: custom.state ?? "",
    };
  }

  const other = activities.find((a) => a.type !== 4);
  if (other) {
    const verb = ACTIVITY_VERB[other.type] ?? "";
    return { text: [verb, other.name].filter(Boolean).join(" ") };
  }

  return null;
}

function renderStatusBubble(content: ActivityContent | null) {
  statusBubbleEl.replaceChildren();

  if (!content) {
    statusBubbleEl.hidden = true;
    return;
  }

  if (content.emojiUrl) {
    const img = document.createElement("img");
    img.src = content.emojiUrl;
    img.alt = "";
    img.className = "status-emoji";
    statusBubbleEl.appendChild(img);
  } else if (content.emojiUnicode) {
    statusBubbleEl.appendChild(document.createTextNode(`${content.emojiUnicode} `));
  }

  if (content.text) {
    statusBubbleEl.appendChild(document.createTextNode(content.text));
  }

  statusBubbleEl.hidden = !content.text && !content.emojiUrl && !content.emojiUnicode;
}

let lastBgAvatarUrl = "";

function renderDiscord(data: LanyardData) {
  avatarEl.src = discordAvatarUrl(data.discord_user, 128);
  avatarEl.alt = data.discord_user.global_name || data.discord_user.username;
  avatarEl.classList.remove("is-hidden");
  avatarPlaceholderEl.classList.add("is-hidden");

  // Larger source for the background blur — blur washes out detail anyway,
  // so a bigger fetch just avoids visible pixelation/banding once scaled up.
  const bgUrl = discordAvatarUrl(data.discord_user, 512);
  if (bgUrl !== lastBgAvatarUrl) {
    lastBgAvatarUrl = bgUrl;
    bgAvatarEl.style.backgroundImage = `url(${bgUrl})`;
    document.body.classList.add("has-avatar-bg");
    void estimateLuminance(bgUrl).then((luminance) => {
      document.body.classList.toggle("dark-bg-text", luminance < 0.45);
    });
  }

  statusDotEl.dataset.status = data.discord_status;
  statusDotEl.setAttribute("aria-label", `Discord status: ${STATUS_LABEL[data.discord_status]}`);

  renderStatusBubble(getActivityContent(data.activities));
}

avatarEl.addEventListener("error", () => {
  avatarEl.classList.add("is-hidden");
  avatarPlaceholderEl.classList.remove("is-hidden");
});

const lanyard = new LanyardClient(config.discord.userId);
lanyard.onUpdate(renderDiscord);
void lanyard.start();

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

const viewsPillEl = document.getElementById("views-pill")!;
const viewsCountEl = document.getElementById("views-count")!;
void fetchViewCount().then((count) => {
  if (count === null) return;
  viewsPillEl.hidden = false;
  animateCount(viewsCountEl, count, (n) => n.toLocaleString());
});

const nowPlayingEl = document.getElementById("now-playing") as HTMLAnchorElement;
const nowPlayingArtEl = document.getElementById("now-playing-art") as HTMLImageElement;
const nowPlayingTitleEl = document.getElementById("now-playing-title")!;
const nowPlayingArtistEl = document.getElementById("now-playing-artist")!;

watchNowPlaying((data) => {
  if (!data.isPlaying) {
    nowPlayingEl.hidden = true;
    return;
  }
  nowPlayingEl.href = data.url ?? "#";
  nowPlayingArtEl.src = data.albumArt ?? "";
  nowPlayingTitleEl.textContent = data.title ?? "";
  nowPlayingArtistEl.textContent = data.artist ?? "";
  nowPlayingEl.hidden = false;
});
