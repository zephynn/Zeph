import "./style.css";
import { fetchPortfolio } from "./lib/portfolio";
import { fetchReviews, submitReview } from "./lib/reviews";

const yearEl = document.getElementById("year")!;
yearEl.textContent = String(new Date().getFullYear());

const rootEl = document.getElementById("project-root")!;

const slug = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() ?? "");

function renderStars(rating: number): string {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

void fetchPortfolio().then((projects) => {
  const project = projects.find((p) => p.slug === slug);

  if (!project) {
    rootEl.innerHTML = `<p class="project-not-found">Couldn't find that project.</p>`;
    return;
  }

  // project.* comes from the password-gated admin (api/portfolio/save.ts), not
  // visitor input, so innerHTML here is safe — unlike review name/comment below.
  document.title = `${project.title} — zephyn`;

  const thumbHtml = project.image
    ? `<div class="project-detail__thumb" style="background-image:url('${project.image}')"></div>`
    : `<div class="project-detail__thumb project-detail__thumb--placeholder">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.4" />
          <circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" stroke-width="1.4" />
          <path d="M3 16L8 11L12 15L16 11L21 16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>`;

  const paragraphs = project.detail
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const linkHtml =
    project.url && project.url !== "#"
      ? `<a class="project-detail__link" href="${project.url}" target="_blank" rel="noopener noreferrer">Visit project</a>`
      : "";

  rootEl.innerHTML = `
    <article class="project-detail">
      ${thumbHtml}
      <h1 class="project-detail__title">${project.title}</h1>
      ${paragraphs.map((p) => `<p class="project-detail__body">${p}</p>`).join("")}
      ${linkHtml}
    </article>

    <section class="reviews-section" aria-labelledby="reviews-heading">
      <h2 class="reviews-heading" id="reviews-heading">Reviews</h2>
      <div id="reviews-list" class="reviews-list">
        <p class="reviews-empty">Loading reviews&hellip;</p>
      </div>

      <form id="review-form" class="review-form">
        <label class="review-form__field">
          <span>Name</span>
          <input type="text" name="name" maxlength="60" required />
        </label>

        <label class="review-form__field">
          <span>Rating</span>
          <select name="rating" required>
            <option value="5">★★★★★ (5)</option>
            <option value="4">★★★★☆ (4)</option>
            <option value="3">★★★☆☆ (3)</option>
            <option value="2">★★☆☆☆ (2)</option>
            <option value="1">★☆☆☆☆ (1)</option>
          </select>
        </label>

        <label class="review-form__field">
          <span>Comment</span>
          <textarea name="comment" maxlength="600" rows="4" required></textarea>
        </label>

        <label class="review-form__honeypot" aria-hidden="true">
          Website
          <input type="text" name="website" tabindex="-1" autocomplete="off" />
        </label>

        <button type="submit" class="review-form__submit">Submit review</button>
        <p class="review-form__status" id="review-form-status" role="status"></p>
      </form>
    </section>
  `;

  const reviewsListEl = document.getElementById("reviews-list")!;

  // Built with createElement/textContent rather than innerHTML — review name
  // and comment are visitor-submitted, so they must never be parsed as HTML.
  void fetchReviews(project.slug).then((reviews) => {
    reviewsListEl.replaceChildren();

    if (reviews.length === 0) {
      const empty = document.createElement("p");
      empty.className = "reviews-empty";
      empty.textContent = "No reviews yet — be the first.";
      reviewsListEl.appendChild(empty);
      return;
    }

    for (const review of reviews) {
      const card = document.createElement("div");
      card.className = "review-card";

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

      const date = document.createElement("span");
      date.className = "review-card__date";
      date.textContent = formatDate(review.createdAt);

      card.append(top, comment, date);
      reviewsListEl.appendChild(card);
    }
  });

  const formEl = document.getElementById("review-form") as HTMLFormElement;
  const statusEl = document.getElementById("review-form-status")!;

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(formEl);

    statusEl.textContent = "Submitting…";
    statusEl.className = "review-form__status";

    void submitReview({
      projectId: project.slug,
      name: String(formData.get("name") ?? ""),
      rating: Number(formData.get("rating")),
      comment: String(formData.get("comment") ?? ""),
      website: String(formData.get("website") ?? ""),
    }).then((result) => {
      if (result.ok) {
        statusEl.textContent = "Thanks! Your review is pending approval.";
        statusEl.className = "review-form__status review-form__status--ok";
        formEl.reset();
      } else {
        statusEl.textContent = result.error ?? "Something went wrong.";
        statusEl.className = "review-form__status review-form__status--error";
      }
    });
  });
});
