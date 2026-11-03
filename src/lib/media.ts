export type MediaType = "song" | "game" | "movie" | "show" | "anime" | "manga";

export interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  by: string;
  year: string;
  cover: string;
  url: string;
  overview: string;
  facts: Array<[string, string]>;
  note: string;
  rating: number; // 0 = not rated, otherwise 1–5
  favourite: boolean;
  addedAt: number;
}

/** A search hit from api/media/search.ts — not saved yet, no full details. */
export interface MediaSearchResult {
  type: MediaType;
  externalId: string;
  title: string;
  by: string;
  year: string;
  cover: string;
}

/** Row order on the shelf, with each row's heading. */
export const CATEGORIES: Array<[MediaType, string]> = [
  ["song", "Songs"],
  ["game", "Games"],
  ["movie", "Films"],
  ["show", "Shows"],
  ["anime", "Anime"],
  ["manga", "Manga"],
];

export const TYPE_LABEL: Record<MediaType, string> = {
  song: "Song",
  game: "Game",
  movie: "Film",
  show: "Show",
  anime: "Anime",
  manga: "Manga",
};

export const SOURCE_NAME: Record<MediaType, string> = {
  song: "Apple Music",
  game: "IGDB",
  movie: "TMDB",
  show: "TMDB",
  anime: "AniList",
  manga: "AniList",
};

export const isSquare = (type: MediaType) => type === "song";

export const mediaId = (r: Pick<MediaSearchResult, "type" | "externalId">) => `${r.type}-${r.externalId}`;

export async function fetchMedia(): Promise<MediaItem[]> {
  try {
    const res = await fetch("/api/media/items");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

export async function fetchMediaItem(id: string): Promise<MediaItem | null> {
  try {
    const res = await fetch(`/api/media/items?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.item ?? null;
  } catch {
    return null;
  }
}

/**
 * A cover sized by type (tall poster or square song art). Falls back to a
 * lettered tile if there's no cover or the provider's image link has died.
 */
export function buildCover(item: Pick<MediaItem, "type" | "title" | "cover">, opts: { favourite?: boolean; eager?: boolean } = {}): HTMLElement {
  const cover = document.createElement("div");
  cover.className = `media-cover${isSquare(item.type) ? " media-cover--square" : ""}`;

  const showFallback = () => {
    cover.querySelector("img")?.remove();
    cover.classList.add("media-cover--empty");
    const letter = document.createElement("span");
    letter.className = "media-cover__letter";
    letter.setAttribute("aria-hidden", "true");
    letter.textContent = item.title.trim().charAt(0).toUpperCase() || "?";
    cover.prepend(letter);
  };

  if (item.cover) {
    const img = document.createElement("img");
    img.src = item.cover;
    img.alt = "";
    img.loading = opts.eager ? "eager" : "lazy";
    img.decoding = "async";
    img.draggable = false;
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", showFallback, { once: true });
    cover.appendChild(img);
  } else {
    showFallback();
  }

  if (opts.favourite) {
    const star = document.createElement("span");
    star.className = "media-cover__fav";
    star.setAttribute("aria-hidden", "true");
    star.textContent = "★";
    cover.appendChild(star);
  }

  return cover;
}

/** Whole stars. Returns null for unrated items so nothing is shown. */
export function buildStars(rating: number, className = "media-stars"): HTMLElement | null {
  if (!rating) return null;
  const wrap = document.createElement("span");
  wrap.className = className;
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", `${rating} out of 5 stars`);
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement("span");
    star.setAttribute("aria-hidden", "true");
    if (i > rating) star.className = "is-off";
    star.textContent = "★";
    wrap.appendChild(star);
  }
  return wrap;
}

const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Gentle 3D tilt toward the pointer. Mouse/trackpad only (phones just tap)
 * and skipped under prefers-reduced-motion. Writes two CSS custom properties
 * per pointermove — no layout work.
 */
export function attachTilt(host: HTMLElement, cover: HTMLElement, maxDegrees = 8) {
  if (!canHover.matches || reducedMotion.matches) return;
  host.addEventListener("pointermove", (event) => {
    const rect = cover.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    cover.style.setProperty("--ry", `${(x - 0.5) * maxDegrees * 2}deg`);
    cover.style.setProperty("--rx", `${(0.5 - y) * maxDegrees * 2}deg`);
  });
  host.addEventListener("pointerleave", () => {
    cover.style.setProperty("--rx", "0deg");
    cover.style.setProperty("--ry", "0deg");
  });
}

export const prefersReducedMotion = () => reducedMotion.matches;
