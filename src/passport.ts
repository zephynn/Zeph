import "./style.css";
import { buildCover, fetchPassport, TYPE_LABEL, type PassportItem } from "./lib/passport";

const yearEl = document.getElementById("year")!;
yearEl.textContent = String(new Date().getFullYear());

const rootEl = document.getElementById("passport-root")!;

function formatMonth(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** Note text → one <p> per blank-line-separated paragraph. textContent only, never innerHTML. */
function buildNote(note: string, className: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = className;
  for (const paragraph of note.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    const p = document.createElement("p");
    p.textContent = paragraph;
    wrap.appendChild(p);
  }
  return wrap;
}

function buildCard(item: PassportItem, variant: "feature" | "entry"): HTMLElement {
  const card = document.createElement("article");
  card.className = `passport-card passport-card--${variant}`;

  const cover = buildCover(item, "passport-card__cover");

  const body = document.createElement("div");
  body.className = "passport-card__body";

  const meta = document.createElement("p");
  meta.className = "passport-card__meta";
  const chip = document.createElement("span");
  chip.className = "passport-chip";
  chip.textContent = TYPE_LABEL[item.type];
  meta.appendChild(chip);
  if (item.shelf === "current" && variant === "entry") {
    const since = document.createElement("span");
    since.className = "passport-card__since";
    since.textContent = `since ${formatMonth(item.addedAt)}`;
    meta.appendChild(since);
  }

  const title = document.createElement(variant === "feature" ? "h3" : "h4");
  title.className = "passport-card__title";
  if (item.url) {
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.title;
    title.appendChild(link);
  } else {
    title.textContent = item.title;
  }

  const subtitle = document.createElement("p");
  subtitle.className = "passport-card__subtitle";
  subtitle.textContent = item.subtitle;

  body.append(meta, title);
  if (item.subtitle) body.appendChild(subtitle);
  body.appendChild(buildNote(item.note, "passport-card__note"));

  card.append(cover, body);
  return card;
}

function buildSection(label: string, items: PassportItem[], variant: "feature" | "entry"): HTMLElement {
  const section = document.createElement("section");
  section.className = "passport-section";

  const heading = document.createElement("h2");
  heading.className = "group__label passport-section__label";
  heading.append(label);
  const rule = document.createElement("span");
  rule.className = "group__rule";
  rule.setAttribute("aria-hidden", "true");
  heading.appendChild(rule);

  const list = document.createElement("div");
  list.className = "passport-list";
  for (const item of items) list.appendChild(buildCard(item, variant));

  section.append(heading, list);
  return section;
}

void fetchPassport().then((items) => {
  rootEl.removeAttribute("aria-busy");

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reviews-empty";
    empty.textContent = "Nothing stamped yet — check back soon.";
    rootEl.appendChild(empty);
    return;
  }

  // The featured item is shown once, as the Obsession — not again in its shelf.
  const obsession = items.find((item) => item.featured);
  const rest = items.filter((item) => item !== obsession);
  const current = rest.filter((item) => item.shelf === "current");
  const allTime = rest.filter((item) => item.shelf === "alltime");

  if (obsession) rootEl.appendChild(buildSection("Obsession", [obsession], "feature"));
  if (current.length > 0) rootEl.appendChild(buildSection("Currently", current, "entry"));
  if (allTime.length > 0) rootEl.appendChild(buildSection("All-time", allTime, "entry"));
});
