import "./style.css";
import { config } from "./config";

interface Review {
  id: string;
  projectId: string;
  name: string;
  rating: number;
  comment: string;
  status: "pending" | "approved";
  createdAt: number;
}

// In-memory only for this page load — never persisted, never sent anywhere
// except as the Authorization header on admin API calls.
let password = "";

const unlockForm = document.getElementById("unlock-form") as HTMLFormElement;
const unlockStatus = document.getElementById("unlock-status")!;
const adminRoot = document.getElementById("admin-root")!;

function renderStars(rating: number): string {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function projectTitle(projectId: string): string {
  return config.portfolio.find((p) => p.slug === projectId)?.title ?? projectId;
}

function buildReviewRow(review: Review, onAction: (action: "approve" | "reject") => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "admin-review";

  const top = document.createElement("div");
  top.className = "review-card__top";

  const name = document.createElement("span");
  name.className = "review-card__name";
  name.textContent = review.name;

  const stars = document.createElement("span");
  stars.className = "review-card__stars";
  stars.textContent = renderStars(review.rating);

  top.append(name, stars);

  const project = document.createElement("span");
  project.className = "admin-review__project";
  project.textContent = projectTitle(review.projectId);

  const comment = document.createElement("p");
  comment.className = "review-card__comment";
  comment.textContent = review.comment;

  const actions = document.createElement("div");
  actions.className = "admin-review__actions";

  if (review.status === "pending") {
    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "admin-review__approve";
    approveBtn.textContent = "Approve";
    approveBtn.addEventListener("click", () => onAction("approve"));

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "admin-review__reject";
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => onAction("reject"));

    actions.append(approveBtn, rejectBtn);
  } else {
    const badge = document.createElement("span");
    badge.className = "admin-review__badge";
    badge.textContent = "Approved";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "admin-review__reject";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => onAction("reject"));

    actions.append(badge, removeBtn);
  }

  row.append(top, project, comment, actions);
  return row;
}

async function loadReviews() {
  adminRoot.replaceChildren();

  const res = await fetch("/api/reviews/admin-data", {
    headers: { Authorization: `Bearer ${password}` },
  });

  if (res.status === 401) {
    adminRoot.hidden = true;
    unlockStatus.textContent = "Incorrect password.";
    unlockStatus.className = "review-form__status review-form__status--error";
    return;
  }

  if (!res.ok) {
    unlockStatus.textContent = "Could not load reviews.";
    unlockStatus.className = "review-form__status review-form__status--error";
    return;
  }

  const data = await res.json();
  const reviews: Review[] = Array.isArray(data.reviews) ? data.reviews : [];

  unlockForm.hidden = true;
  adminRoot.hidden = false;

  const pending = reviews.filter((r) => r.status === "pending");
  const approved = reviews.filter((r) => r.status === "approved");

  const pendingSection = document.createElement("section");
  const pendingHeading = document.createElement("h2");
  pendingHeading.className = "reviews-heading";
  pendingHeading.textContent = `Pending (${pending.length})`;
  pendingSection.appendChild(pendingHeading);

  if (pending.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reviews-empty";
    empty.textContent = "Nothing waiting on review.";
    pendingSection.appendChild(empty);
  } else {
    for (const review of pending) {
      pendingSection.appendChild(buildReviewRow(review, (action) => moderate(review.id, action)));
    }
  }

  const approvedSection = document.createElement("section");
  approvedSection.style.marginTop = "32px";
  const approvedHeading = document.createElement("h2");
  approvedHeading.className = "reviews-heading";
  approvedHeading.textContent = `Approved (${approved.length})`;
  approvedSection.appendChild(approvedHeading);

  if (approved.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reviews-empty";
    empty.textContent = "Nothing approved yet.";
    approvedSection.appendChild(empty);
  } else {
    for (const review of approved) {
      approvedSection.appendChild(buildReviewRow(review, (action) => moderate(review.id, action)));
    }
  }

  adminRoot.append(pendingSection, approvedSection);
}

async function moderate(id: string, action: "approve" | "reject") {
  await fetch("/api/reviews/moderate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${password}` },
    body: JSON.stringify({ id, action }),
  });
  void loadReviews();
}

unlockForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(unlockForm);
  password = String(formData.get("password") ?? "");
  unlockStatus.textContent = "Checking…";
  unlockStatus.className = "review-form__status";
  void loadReviews();
});
