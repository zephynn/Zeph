export type PassportType = "movie" | "show" | "anime" | "manga" | "game" | "album" | "song";
export type Shelf = "current" | "alltime";

export interface PassportItem {
  id: string;
  type: PassportType;
  title: string;
  subtitle: string;
  cover: string;
  url: string;
  note: string;
  shelf: Shelf;
  featured: boolean;
  addedAt: number;
}

/** A normalised search hit from api/passport/search.ts — not yet saved. */
export interface PassportSearchResult {
  type: PassportType;
  externalId: string;
  title: string;
  subtitle: string;
  cover: string;
  url: string;
}

export const TYPE_LABEL: Record<PassportType, string> = {
  movie: "Film",
  show: "Show",
  anime: "Anime",
  manga: "Manga",
  game: "Game",
  album: "Album",
  song: "Song",
};

/** Which cover shape a type uses — posters/box art are tall, music is square. */
export function coverShape(type: PassportType): "tall" | "square" {
  return type === "album" || type === "song" ? "square" : "tall";
}

export function passportId(result: Pick<PassportSearchResult, "type" | "externalId">): string {
  return `${result.type}-${result.externalId}`;
}

export async function fetchPassport(): Promise<PassportItem[]> {
  try {
    const res = await fetch("/api/passport/items");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/**
 * Builds a cover element sized by type. Uses a real <img> (lazy-loaded,
 * with alt text) rather than a CSS background, and falls back to a
 * lettered tile if there's no cover or the provider's CDN link has died.
 */
export function buildCover(item: Pick<PassportItem, "type" | "title" | "cover">, className: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `${className} passport-cover passport-cover--${coverShape(item.type)}`;

  const showFallback = () => {
    wrap.replaceChildren();
    wrap.classList.add("passport-cover--empty");
    const letter = document.createElement("span");
    letter.textContent = item.title.trim().charAt(0).toUpperCase() || "?";
    letter.setAttribute("aria-hidden", "true");
    wrap.appendChild(letter);
  };

  if (!item.cover) {
    showFallback();
    return wrap;
  }

  const img = document.createElement("img");
  img.src = item.cover;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", showFallback, { once: true });
  wrap.appendChild(img);
  return wrap;
}
