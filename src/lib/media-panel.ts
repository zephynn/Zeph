import { attachTilt, buildCover, buildStars, CATEGORIES, fetchMedia, isSquare, prefersReducedMotion, type MediaItem } from "./media";

/**
 * The home page's Media panel. Opens from the "Media" row: on wide screens
 * the main card slides left and the panel sits beside it; on narrower ones
 * it slides up as a full-screen sheet. URL hash #media opens it directly,
 * and the back button closes it (so /#media links and the detail page's
 * "Back" both land here).
 */
export function setupMediaPanel() {
  const panel = document.getElementById("media-panel")!;
  const body = document.getElementById("media-panel-body")!;
  const status = document.getElementById("media-panel-status")!;
  const openBtn = document.getElementById("media-open") as HTMLButtonElement;
  const closeBtn = document.getElementById("media-close") as HTMLButtonElement;

  let loaded: Promise<void> | null = null;
  let openedByClick = false;
  let hideTimer = 0;

  function load() {
    loaded ??= fetchMedia().then((items) => {
      if (items.length === 0) {
        status.textContent = "Nothing here yet.";
        return;
      }
      status.remove();
      renderRows(body, items);
      const credit = document.createElement("p");
      credit.className = "media-credit media-panel__credit";
      credit.textContent =
        "Artwork and info from TMDB, AniList, IGDB and Apple Music. This product uses the TMDB API but is not endorsed or certified by TMDB.";
      body.appendChild(credit);
    });
    return loaded;
  }

  function setOpen(open: boolean) {
    const isOpen = document.body.classList.contains("media-is-open");
    if (open === isOpen) return;
    window.clearTimeout(hideTimer);
    openBtn.setAttribute("aria-expanded", String(open));

    if (open) {
      void load();
      panel.hidden = false;
      // Next frame, so the slide-in transition starts from the off-screen state.
      requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("media-is-open")));
      closeBtn.focus({ preventScroll: true });
    } else {
      document.body.classList.remove("media-is-open");
      hideTimer = window.setTimeout(() => (panel.hidden = true), prefersReducedMotion() ? 0 : 500);
      openBtn.focus({ preventScroll: true });
    }
  }

  const syncWithHash = () => {
    const open = location.hash === "#media";
    if (!open) openedByClick = false;
    setOpen(open);
  };

  openBtn.addEventListener("click", () => {
    openedByClick = true;
    location.hash = "media";
  });
  // Warm the data up as soon as someone looks like they'll open it.
  openBtn.addEventListener("pointerenter", () => void load(), { once: true });
  openBtn.addEventListener("focus", () => void load(), { once: true });

  function close() {
    // If we pushed #media ourselves, step back so the history stays clean;
    // otherwise (arrived via a /#media link) just drop the hash.
    if (openedByClick) {
      openedByClick = false;
      history.back();
    } else {
      history.replaceState(null, "", location.pathname + location.search);
      setOpen(false);
    }
  }

  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("media-is-open")) close();
  });

  window.addEventListener("hashchange", syncWithHash);
  syncWithHash();
}

function renderRows(body: HTMLElement, items: MediaItem[]) {
  for (const [type, label] of CATEGORIES) {
    // Favourites lead each row; otherwise newest first (the API's order).
    const rowItems = items.filter((item) => item.type === type).sort((a, b) => Number(b.favourite) - Number(a.favourite));
    if (rowItems.length === 0) continue;

    const section = document.createElement("section");
    section.className = "media-row";
    section.setAttribute("aria-label", label);

    const heading = document.createElement("h3");
    heading.className = "group__label media-row__label";
    heading.append(label);
    const rule = document.createElement("span");
    rule.className = "group__rule";
    rule.setAttribute("aria-hidden", "true");
    heading.appendChild(rule);

    const track = document.createElement("div");
    track.className = "media-row__track";
    for (const item of rowItems) track.appendChild(buildCard(item));

    section.append(heading, track, ...buildArrows(track, label));
    body.appendChild(section);
  }
}

function buildCard(item: MediaItem): HTMLElement {
  const card = document.createElement("a");
  card.className = `media-card${isSquare(item.type) ? " media-card--square" : ""}`;
  card.href = `/media/${encodeURIComponent(item.id)}`;
  card.setAttribute("aria-label", `${item.title}${item.by ? ` by ${item.by}` : ""}${item.favourite ? ", favourite" : ""}`);

  const cover = buildCover(item, { favourite: item.favourite });
  const title = document.createElement("span");
  title.className = "media-card__title";
  title.textContent = item.title;
  card.append(cover, title);

  const stars = buildStars(item.rating);
  if (stars) card.appendChild(stars);

  attachTilt(card, cover);
  return card;
}

/** Scroll arrows for mouse users. They only appear while hovering the row. */
function buildArrows(track: HTMLElement, label: string): HTMLButtonElement[] {
  const arrows = ([-1, 1] as const).map((direction) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `media-round media-row__arrow media-row__arrow--${direction < 0 ? "prev" : "next"}`;
    button.setAttribute("aria-label", `Scroll ${label} ${direction < 0 ? "left" : "right"}`);
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${
      direction < 0 ? "M15 6L9 12L15 18" : "M9 6L15 12L9 18"
    }" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
    button.addEventListener("click", () =>
      track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: prefersReducedMotion() ? "auto" : "smooth" }),
    );
    return button;
  });

  const sync = () => {
    arrows[0].disabled = track.scrollLeft < 4;
    arrows[1].disabled = track.scrollLeft + track.clientWidth > track.scrollWidth - 4;
  };
  track.addEventListener("scroll", sync, { passive: true });
  new ResizeObserver(sync).observe(track);
  return arrows;
}
