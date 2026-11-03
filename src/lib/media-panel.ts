import { attachTilt, buildCover, buildStars, CATEGORIES, fetchMedia, isSquare, prefersReducedMotion, TYPE_LABEL, type MediaItem } from "./media";

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

  const peek = setupPeek();
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
      renderRows(body, items, peek.open);
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
      peek.close(false);
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
    if (event.key !== "Escape" || !document.body.classList.contains("media-is-open")) return;
    // Esc closes the note preview first, then the panel.
    if (peek.isOpen()) peek.close(true);
    else close();
  });

  window.addEventListener("hashchange", syncWithHash);
  syncWithHash();
}

/**
 * The note preview: clicking a cover opens a small card over the panel with
 * your note (or a short overview if there's no note) and a link to the full
 * page. Ctrl/Cmd/middle-click on a cover still opens the full page directly.
 */
function setupPeek() {
  const root = document.getElementById("media-peek")!;
  const card = document.getElementById("media-peek-card")!;
  const scrim = document.getElementById("media-peek-scrim")!;
  let returnFocus: HTMLElement | null = null;
  let hideTimer = 0;

  function close(restoreFocus: boolean) {
    if (root.hidden) return;
    root.classList.remove("is-shown");
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => (root.hidden = true), prefersReducedMotion() ? 0 : 220);
    if (restoreFocus) returnFocus?.focus({ preventScroll: true });
  }

  function open(item: MediaItem, from: HTMLElement) {
    returnFocus = from;
    window.clearTimeout(hideTimer);
    card.replaceChildren(...buildPeekContent(item, () => close(true)));
    root.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-shown")));
    card.querySelector<HTMLElement>(".media-peek__close")?.focus({ preventScroll: true });
  }

  scrim.addEventListener("click", () => close(true));
  return { open, close, isOpen: () => !root.hidden };
}

function buildPeekContent(item: MediaItem, onClose: () => void): HTMLElement[] {
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "media-round media-peek__close";
  closeBtn.setAttribute("aria-label", "Close preview");
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>`;
  closeBtn.addEventListener("click", onClose);

  const top = document.createElement("div");
  top.className = "media-peek__top";
  const coverWrap = document.createElement("div");
  coverWrap.className = `media-peek__cover${isSquare(item.type) ? " media-peek__cover--square" : ""}`;
  coverWrap.appendChild(buildCover(item, { eager: true }));

  const heading = document.createElement("div");
  heading.className = "media-peek__heading";
  const type = document.createElement("p");
  type.className = "media-detail__type";
  type.textContent = [TYPE_LABEL[item.type], item.year].filter(Boolean).join(" · ");
  const title = document.createElement("h3");
  title.className = "media-peek__title";
  title.id = "media-peek-title";
  title.textContent = item.title;
  heading.append(type, title);
  if (item.by) {
    const by = document.createElement("p");
    by.className = "media-peek__by";
    by.textContent = item.by;
    heading.appendChild(by);
  }
  const rating = document.createElement("div");
  rating.className = "media-detail__rating";
  const stars = buildStars(item.rating);
  if (stars) rating.appendChild(stars);
  if (item.favourite) rating.append("★ Favourite");
  if (rating.childNodes.length) heading.appendChild(rating);
  top.append(coverWrap, heading);

  // Your note is the point; with no note, a short overview stands in (muted).
  const text = document.createElement("div");
  text.className = item.note ? "media-peek__note" : "media-peek__note media-peek__note--overview";
  const source = item.note || item.overview;
  for (const para of source.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    const p = document.createElement("p");
    p.textContent = para;
    text.appendChild(p);
  }

  const link = document.createElement("a");
  link.className = "project-detail__link media-peek__link";
  link.href = `/media/${encodeURIComponent(item.id)}`;
  link.textContent = "Full page";

  return text.childElementCount ? [closeBtn, top, text, link] : [closeBtn, top, link];
}

function renderRows(body: HTMLElement, items: MediaItem[], openPeek: (item: MediaItem, from: HTMLElement) => void) {
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
    for (const item of rowItems) track.appendChild(buildCard(item, openPeek));

    section.append(heading, track, ...buildArrows(track, label));
    body.appendChild(section);
  }
}

function buildCard(item: MediaItem, openPeek: (item: MediaItem, from: HTMLElement) => void): HTMLElement {
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

  card.addEventListener("click", (event) => {
    // Let "open in new tab" gestures go straight to the full page.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    openPeek(item, card);
  });

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
