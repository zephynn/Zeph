import { attachTilt, buildCover, buildStars, CATEGORIES, fetchMedia, isSquare, prefersReducedMotion, SOURCE_NAME, TYPE_LABEL, type MediaItem } from "./media";

/**
 * The home page's Media panel. Opens from the "Media" row: on wide screens
 * the main card slides left and the panel sits beside it; on narrower ones
 * it slides up as a full-screen sheet. URL hash #media opens it directly,
 * and the back button closes it.
 *
 * Clicking a cover flips it: the card lifts out of its row, grows into the
 * middle of the panel while turning over, and shows the back (your note,
 * rating, a song preview). See setupFlip().
 */
export function setupMediaPanel() {
  const panel = document.getElementById("media-panel")!;
  const body = document.getElementById("media-panel-body")!;
  const status = document.getElementById("media-panel-status")!;
  const openBtn = document.getElementById("media-open") as HTMLButtonElement;
  const closeBtn = document.getElementById("media-close") as HTMLButtonElement;

  const flip = setupFlip(panel);
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
      renderRows(body, items, flip.open);
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
      flip.close({ instant: true });
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
    // Esc flips an open card back first, then closes the panel.
    if (flip.isOpen()) flip.close();
    else close();
  });

  window.addEventListener("hashchange", syncWithHash);
  syncWithHash();
}

// --- Flip card ---

type OpenFlip = (item: MediaItem, card: HTMLElement, cover: HTMLElement) => void | Promise<void>;

const FLIP_MS = 620;
const FLIP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const rectFrame = (r: Rect): Keyframe => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });

function setupFlip(panel: HTMLElement) {
  const root = document.getElementById("media-flip")!;
  const card = document.getElementById("media-flip-card")!;
  const inner = document.getElementById("media-flip-inner")!;
  const scrim = document.getElementById("media-flip-scrim")!;
  const audio = new Audio();
  audio.preload = "none";

  let current: { card: HTMLElement; cover: HTMLElement; listeners: AbortController } | null = null;

  function place(rect: Rect) {
    Object.assign(card.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }

  /** Centre of the panel. Fixed width; height fits the back's content, capped by the panel. */
  function targetRect(): Rect {
    const area = panel.getBoundingClientRect();
    const width = Math.min(380, area.width - 32);
    const maxHeight = Math.min(560, area.height - 48);
    let natural = width;
    const content = inner.querySelector<HTMLElement>(".media-flip__content");
    if (content) {
      const probe = content.cloneNode(true) as HTMLElement;
      Object.assign(probe.style, {
        position: "fixed",
        left: "-9999px",
        top: "0",
        width: `${width}px`,
        height: "auto",
        overflow: "visible",
        visibility: "hidden",
      });
      document.body.appendChild(probe);
      natural = probe.scrollHeight;
      probe.remove();
    }
    const height = Math.max(Math.min(width * 0.72, maxHeight), Math.min(natural, maxHeight));
    return { left: area.left + (area.width - width) / 2, top: area.top + (area.height - height) / 2, width, height };
  }

  function stopAudio() {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  async function open(item: MediaItem, sourceCard: HTMLElement, sourceCover: HTMLElement) {
    if (current) return;
    // Everything the back attaches to shared objects (the <audio>) is removed on close.
    const listeners = new AbortController();
    current = { card: sourceCard, cover: sourceCover, listeners };

    const front = await buildFront(item);
    if (current?.listeners !== listeners) return; // closed while the image was decoding
    inner.replaceChildren(front, buildBack(item, audio, listeners.signal, () => close()));

    const from = sourceCover.getBoundingClientRect();
    const to = targetRect();
    place(from);
    root.hidden = false;
    sourceCover.style.visibility = "hidden"; // the card "lifts out" of its row
    requestAnimationFrame(() => root.classList.add("is-shown"));

    if (prefersReducedMotion()) {
      place(to);
      inner.style.transform = "rotateY(180deg)";
    } else {
      card.animate([rectFrame(from), rectFrame(to)], { duration: FLIP_MS, easing: FLIP_EASE, fill: "forwards" }).finished.then(() => {
        place(to);
        card.getAnimations().forEach((a) => a.cancel());
      }, () => {});
      inner.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(180deg)" }], { duration: FLIP_MS, easing: FLIP_EASE, fill: "forwards" });
    }
    window.setTimeout(
      () => inner.querySelector<HTMLElement>(".media-flip__close")?.focus({ preventScroll: true }),
      prefersReducedMotion() ? 0 : FLIP_MS * 0.6,
    );
  }

  function close({ instant = false } = {}) {
    if (!current) return;
    const { card: sourceCard, cover: sourceCover, listeners } = current;
    listeners.abort();
    stopAudio();
    root.classList.remove("is-shown");

    const done = () => {
      root.hidden = true;
      sourceCover.style.visibility = "";
      card.getAnimations().forEach((a) => a.cancel());
      inner.getAnimations().forEach((a) => a.cancel());
      inner.style.transform = "";
      inner.replaceChildren();
      current = null;
      if (!instant) sourceCard.focus({ preventScroll: true });
    };

    if (instant || prefersReducedMotion()) {
      done();
      return;
    }
    const from = card.getBoundingClientRect();
    const to = sourceCover.getBoundingClientRect();
    const duration = FLIP_MS * 0.85;
    card.getAnimations().forEach((a) => a.cancel());
    place(from);
    inner.getAnimations().forEach((a) => a.cancel());
    card.animate([rectFrame(from), rectFrame(to)], { duration, easing: FLIP_EASE, fill: "forwards" });
    inner
      .animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(360deg)" }], { duration, easing: FLIP_EASE, fill: "forwards" })
      .finished.then(done, done);
  }

  scrim.addEventListener("click", () => close());
  window.addEventListener("resize", () => {
    if (current) place(targetRect());
  });

  return { open, close, isOpen: () => current !== null };
}

/**
 * The front while it flips: the cover at its true shape (never re-cropped as
 * the card grows) over its own blurred artwork, which fills the extra space.
 * Waits for the image to decode so the first frame isn't a blank tile.
 */
async function buildFront(item: MediaItem): Promise<HTMLElement> {
  const front = document.createElement("div");
  front.className = "media-flip__face media-flip__front";
  if (!item.cover) {
    front.appendChild(buildCover(item, { eager: true }));
    return front;
  }
  const tint = document.createElement("div");
  tint.className = "media-flip__tint";
  tint.style.backgroundImage = `url("${item.cover}")`;
  const art = new Image();
  art.className = "media-flip__art";
  art.alt = "";
  art.referrerPolicy = "no-referrer";
  art.src = item.cover; // already in the browser cache from the row
  await art.decode().catch(() => {});
  front.append(tint, art);
  return front;
}

function formatSince(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

/** The back of a flipped card: about you, not the item. */
function buildBack(item: MediaItem, audio: HTMLAudioElement, signal: AbortSignal, onClose: () => void): HTMLElement {
  const back = document.createElement("div");
  back.className = "media-flip__face media-flip__back";

  // The cover itself, heavily blurred and darkened, so each back looks like its own artwork.
  if (item.cover) {
    const tint = document.createElement("div");
    tint.className = "media-flip__tint";
    tint.style.backgroundImage = `url("${item.cover}")`;
    back.appendChild(tint);
  }

  const content = document.createElement("div");
  content.className = "media-flip__content";

  const kind = document.createElement("p");
  kind.className = "media-flip__kind";
  kind.textContent = [TYPE_LABEL[item.type], item.by, item.year].filter(Boolean).join(" · ");

  const title = document.createElement("h3");
  title.className = "media-flip__title";
  title.id = "media-flip-title";
  title.textContent = item.title;

  content.append(kind, title);

  const mine = document.createElement("div");
  mine.className = "media-flip__mine";
  const stars = buildStars(item.rating);
  if (stars) mine.appendChild(stars);
  if (item.favourite) mine.append("★ Favourite");
  if (mine.childNodes.length) content.appendChild(mine);

  if (item.type === "song" && item.preview) content.appendChild(buildPlayer(item.preview, audio, signal));

  const note = document.createElement("div");
  note.className = "media-flip__note";
  if (item.note) {
    for (const para of item.note.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
      const p = document.createElement("p");
      p.textContent = para;
      note.appendChild(p);
    }
  } else {
    const empty = document.createElement("p");
    empty.className = "media-flip__empty";
    empty.textContent = "No note on this one yet.";
    note.appendChild(empty);
  }
  content.appendChild(note);

  const foot = document.createElement("div");
  foot.className = "media-flip__foot";
  const since = document.createElement("span");
  since.textContent = `On my shelf since ${formatSince(item.addedAt)}`;
  foot.appendChild(since);
  if (item.url) {
    const source = document.createElement("a");
    source.href = item.url;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.textContent = `${SOURCE_NAME[item.type]} ↗`;
    foot.appendChild(source);
  }
  content.appendChild(foot);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "media-round media-flip__close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>`;
  closeBtn.addEventListener("click", onClose);

  back.append(content, closeBtn);
  return back;
}

const PLAY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" /><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" /></svg>`;

/** Play/pause for Apple's 30-second clip, with a thin progress bar. One shared <audio>. */
function buildPlayer(src: string, audio: HTMLAudioElement, signal: AbortSignal): HTMLElement {
  const player = document.createElement("div");
  player.className = "media-player";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "media-player__button";
  const icon = document.createElement("span");
  icon.className = "media-player__icon";
  const label = document.createElement("span");
  button.append(icon, label);

  const bar = document.createElement("span");
  bar.className = "media-player__bar";
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  fill.className = "media-player__fill";
  bar.appendChild(fill);

  const time = document.createElement("span");
  time.className = "media-player__time";

  const sync = () => {
    const mine = audio.src === src;
    const playing = mine && !audio.paused;
    icon.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    label.textContent = playing ? "Pause" : "Preview";
    button.setAttribute("aria-label", playing ? "Pause preview" : "Play 30-second preview");
    const duration = mine && audio.duration ? audio.duration : 30;
    const elapsed = mine ? audio.currentTime : 0;
    fill.style.transform = `scaleX(${Math.min(1, elapsed / duration)})`;
    const left = Math.max(0, Math.ceil(duration - elapsed));
    time.textContent = `0:${String(left).padStart(2, "0")}`;
  };

  button.addEventListener("click", () => {
    if (audio.src !== src) audio.src = src;
    if (audio.paused) {
      audio.volume = 0.8;
      void audio.play().catch(sync);
    } else {
      audio.pause();
    }
  });
  for (const event of ["play", "pause", "timeupdate", "ended", "emptied"]) audio.addEventListener(event, sync, { signal });
  sync();

  player.append(button, bar, time);
  return player;
}

// --- Rows ---

function renderRows(body: HTMLElement, items: MediaItem[], openFlip: OpenFlip) {
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
    for (const item of rowItems) track.appendChild(buildCard(item, openFlip));

    section.append(heading, track, ...buildArrows(track, label));
    body.appendChild(section);
  }
}

function buildCard(item: MediaItem, openFlip: OpenFlip): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `media-card${isSquare(item.type) ? " media-card--square" : ""}`;
  card.setAttribute("aria-label", `${item.title}${item.by ? ` by ${item.by}` : ""}${item.favourite ? ", favourite" : ""}`);

  const cover = buildCover(item, { favourite: item.favourite });
  const title = document.createElement("span");
  title.className = "media-card__title";
  title.textContent = item.title;
  card.append(cover, title);

  const stars = buildStars(item.rating);
  if (stars) card.appendChild(stars);

  card.addEventListener("click", () => void openFlip(item, card, cover));
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
