import "./style.css";
import { attachTilt, buildCover, buildStars, fetchMediaItem, isSquare, SOURCE_NAME, TYPE_LABEL, type MediaItem } from "./lib/media";

const yearEl = document.getElementById("year")!;
yearEl.textContent = String(new Date().getFullYear());

const rootEl = document.getElementById("media-root")!;
const bgEl = document.getElementById("media-bg")!;

const id = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() ?? "");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Plain text → one <p> per blank-line-separated paragraph. textContent only, never innerHTML. */
function paragraphs(text: string): HTMLElement {
  const wrap = el("div", "media-box__text");
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) wrap.appendChild(el("p", undefined, para));
  return wrap;
}

function setMeta(item: MediaItem) {
  const title = `${item.title} — zephyn`;
  document.title = title;
  const description = item.note || item.overview || `${TYPE_LABEL[item.type]}${item.by ? ` by ${item.by}` : ""}`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", description.slice(0, 160));
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
}

function render(item: MediaItem) {
  setMeta(item);

  if (item.cover) {
    bgEl.style.backgroundImage = `url("${item.cover}")`;
    bgEl.classList.add("is-active");
    document.body.classList.add("has-avatar-bg");
  }

  const article = el("article", "media-detail");

  // Top: cover + title block
  const top = el("div", "media-detail__top");
  const coverWrap = el("div", `media-detail__cover${isSquare(item.type) ? " media-detail__cover--square" : ""}`);
  const cover = buildCover(item, { eager: true });
  coverWrap.appendChild(cover);
  attachTilt(coverWrap, cover);

  const heading = el("div", "media-detail__heading");
  heading.append(el("p", "media-detail__type", TYPE_LABEL[item.type]), el("h1", "media-detail__title", item.title));
  const byline = [item.by, item.year].filter(Boolean).join(" · ");
  if (byline) heading.appendChild(el("p", "media-detail__by", byline));

  const rating = el("div", "media-detail__rating");
  const stars = buildStars(item.rating);
  if (stars) rating.appendChild(stars);
  if (item.favourite) rating.appendChild(el("span", undefined, "★ Favourite"));
  if (rating.childElementCount) heading.appendChild(rating);

  top.append(coverWrap, heading);
  article.appendChild(top);

  // My take (optional)
  if (item.note) {
    const note = el("section", "media-box media-box--note");
    note.append(el("h2", "media-box__label", "My take"), paragraphs(item.note));
    article.appendChild(note);
  }

  // About: overview + facts
  if (item.overview || item.facts.length) {
    const about = el("section", "media-box");
    about.appendChild(el("h2", "media-box__label", "About"));
    if (item.overview) about.appendChild(paragraphs(item.overview));
    if (item.facts.length) {
      const dl = el("dl", "media-facts");
      if (!item.overview) dl.style.marginTop = "0";
      for (const [label, value] of item.facts) dl.append(el("dt", undefined, label), el("dd", undefined, value));
      about.appendChild(dl);
    }
    article.appendChild(about);
  }

  const source = SOURCE_NAME[item.type];
  if (item.url) {
    const link = el("a", "project-detail__link", `View on ${source}`);
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    article.appendChild(link);
  }

  const credit = el("p", "media-credit");
  credit.textContent =
    source === "TMDB"
      ? "Info and artwork from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB."
      : `Info and artwork from ${source}.`;
  article.appendChild(credit);

  rootEl.replaceChildren(article);
}

void fetchMediaItem(id).then((item) => {
  rootEl.removeAttribute("aria-busy");
  if (!item) {
    rootEl.replaceChildren(el("p", "project-not-found", "Couldn't find that one."));
    return;
  }
  render(item);
});
