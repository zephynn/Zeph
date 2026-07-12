import "./style.css";
import { config } from "./config";
import { fetchReviews } from "./lib/reviews";

const yearEl = document.getElementById("year")!;
yearEl.textContent = String(new Date().getFullYear());

const feedEl = document.getElementById("reviews-feed")!;

function renderStars(rating: number): string {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

void fetchReviews().then((reviews) => {
  feedEl.replaceChildren();

  if (reviews.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reviews-empty";
    empty.textContent = "No reviews yet.";
    feedEl.appendChild(empty);
    return;
  }

  for (const review of reviews) {
    const project = config.portfolio.find((p) => p.slug === review.projectId);

    const card = document.createElement(project ? "a" : "div");
    card.className = "review-card review-card--feed";
    if (project) {
      (card as HTMLAnchorElement).href = `/project/${project.slug}`;
    }

    const top = document.createElement("div");
    top.className = "review-card__top";

    const name = document.createElement("span");
    name.className = "review-card__name";
    name.textContent = review.name;

    const stars = document.createElement("span");
    stars.className = "review-card__stars";
    stars.setAttribute("aria-label", `${review.rating} out of 5 stars`);
    stars.textContent = renderStars(review.rating);

    top.append(name, stars);

    const comment = document.createElement("p");
    comment.className = "review-card__comment";
    comment.textContent = review.comment;

    const meta = document.createElement("div");
    meta.className = "review-card__meta";

    const projectLabel = document.createElement("span");
    projectLabel.className = "review-card__project";
    projectLabel.textContent = project ? project.title : "General";

    const date = document.createElement("span");
    date.className = "review-card__date";
    date.textContent = formatDate(review.createdAt);

    meta.append(projectLabel, date);
    card.append(top, comment, meta);
    feedEl.appendChild(card);
  }
});
