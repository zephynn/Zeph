import "./style.css";
import { config } from "./config";

const yearEl = document.getElementById("year")!;
yearEl.textContent = String(new Date().getFullYear());

const gridEl = document.getElementById("portfolio-grid")!;

const placeholderThumbIcon = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.4" />
    <circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" stroke-width="1.4" />
    <path d="M3 16L8 11L12 15L16 11L21 16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

for (const project of config.portfolio) {
  const card = document.createElement("a");
  card.className = "portfolio-card";
  card.href = `/project/${project.slug}`;

  const thumb = document.createElement("div");
  thumb.className = "portfolio-card__thumb";
  if (project.image) {
    thumb.style.backgroundImage = `url(${project.image})`;
  } else {
    thumb.classList.add("portfolio-card__thumb--placeholder");
    thumb.innerHTML = placeholderThumbIcon;
  }

  const title = document.createElement("span");
  title.className = "portfolio-card__title";
  title.textContent = project.title;

  const description = document.createElement("p");
  description.className = "portfolio-card__description";
  description.textContent = project.description;

  const body = document.createElement("div");
  body.className = "portfolio-card__body";
  body.append(title, description);

  card.append(thumb, body);
  gridEl.appendChild(card);
}
