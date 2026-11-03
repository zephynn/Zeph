import "./style.css";
import type { Project } from "./lib/portfolio";
import { fetchPortfolio } from "./lib/portfolio";
import {
  buildCover,
  fetchPassport,
  passportId,
  TYPE_LABEL,
  type PassportItem,
  type PassportSearchResult,
  type PassportType,
  type Shelf,
} from "./lib/passport";

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
let projects: Project[] = [];
let editingSlug: string | null = null;

const unlockForm = document.getElementById("unlock-form") as HTMLFormElement;
const unlockStatus = document.getElementById("unlock-status")!;
const adminRoot = document.getElementById("admin-root")!;
const statsEl = document.getElementById("admin-stats")!;
const reviewsSectionEl = document.getElementById("admin-reviews-section")!;
const portfolioListEl = document.getElementById("portfolio-admin-list")!;
const portfolioForm = document.getElementById("portfolio-form") as HTMLFormElement;
const portfolioFormMode = document.getElementById("portfolio-form-mode")!;
const portfolioFormStatus = document.getElementById("portfolio-form-status")!;
const portfolioFormCancel = document.getElementById("portfolio-form-cancel") as HTMLButtonElement;
const exportCsvBtn = document.getElementById("export-csv") as HTMLButtonElement;

const portfolioFields = {
  slug: portfolioForm.elements.namedItem("slug") as HTMLInputElement,
  title: portfolioForm.elements.namedItem("title") as HTMLInputElement,
  description: portfolioForm.elements.namedItem("description") as HTMLInputElement,
  detail: portfolioForm.elements.namedItem("detail") as HTMLTextAreaElement,
  image: portfolioForm.elements.namedItem("image") as HTMLInputElement,
  url: portfolioForm.elements.namedItem("url") as HTMLInputElement,
};

function renderStars(rating: number): string {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function projectTitle(projectId: string): string {
  return projects.find((p) => p.slug === projectId)?.title ?? projectId;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${password}`, ...extra };
}

// --- Confetti (skipped entirely under prefers-reduced-motion) ---

function burstConfetti(originX: number, originY: number) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const colors = ["#23a55a", "#60a5fa", "#f0b132", "#f9a8d4", "#a78bfa"];
  for (let i = 0; i < 24; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${originX}px`;
    piece.style.top = `${originY}px`;
    piece.style.background = colors[i % colors.length];
    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 100;
    piece.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    piece.style.setProperty("--dy", `${Math.sin(angle) * distance - 40}px`);
    piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    document.body.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove());
  }
}

// --- Easter egg: click the title 5 times fast ---

let titleClicks: number[] = [];
document.getElementById("admin-title")!.addEventListener("click", () => {
  const now = Date.now();
  titleClicks = [...titleClicks.filter((t) => now - t < 1500), now];
  if (titleClicks.length >= 5) {
    titleClicks = [];
    const title = document.getElementById("admin-title")!;
    title.textContent = "okay okay we get it 😅";
    title.classList.add("admin-title--shake");
    window.setTimeout(() => {
      title.textContent = "Review admin";
      title.classList.remove("admin-title--shake");
    }, 1800);
  }
});

// --- Stats bar ---

function renderStats(reviews: Review[], totalViews: number) {
  const approved = reviews.filter((r) => r.status === "approved");
  const pending = reviews.filter((r) => r.status === "pending");
  const avg = approved.length > 0 ? approved.reduce((sum, r) => sum + r.rating, 0) / approved.length : 0;

  let vibe = "🌱 No reviews yet — plant the first one.";
  if (approved.length > 0) {
    if (avg >= 4.5) vibe = "🔥 Certified banger reputation";
    else if (avg >= 3.5) vibe = "😌 Solid, no notes";
    else if (avg >= 2.5) vibe = "😬 Mixed bag energy";
    else vibe = "💀 Rough crowd out there";
  }

  statsEl.innerHTML = "";
  const stats: Array<[string, string]> = [
    ["Total reviews", String(reviews.length)],
    ["Pending", String(pending.length)],
    ["Approved", String(approved.length)],
    ["Avg rating", approved.length > 0 ? avg.toFixed(1) : "—"],
    ["Site views", totalViews.toLocaleString()],
  ];

  for (const [label, value] of stats) {
    const tile = document.createElement("div");
    tile.className = "admin-stat";
    const valueEl = document.createElement("span");
    valueEl.className = "admin-stat__value";
    valueEl.textContent = value;
    const labelEl = document.createElement("span");
    labelEl.className = "admin-stat__label";
    labelEl.textContent = label;
    tile.append(valueEl, labelEl);
    statsEl.appendChild(tile);
  }

  const vibeEl = document.createElement("p");
  vibeEl.className = "admin-vibe";
  vibeEl.textContent = vibe;
  statsEl.appendChild(vibeEl);
}

// --- Review moderation ---

function buildReviewRow(review: Review, onAction: (action: "approve" | "reject", event: MouseEvent) => void): HTMLElement {
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
    approveBtn.addEventListener("click", (event) => onAction("approve", event));

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "admin-review__reject";
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", (event) => onAction("reject", event));

    actions.append(approveBtn, rejectBtn);
  } else {
    const badge = document.createElement("span");
    badge.className = "admin-review__badge";
    badge.textContent = "Approved";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "admin-review__reject";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", (event) => onAction("reject", event));

    actions.append(badge, removeBtn);
  }

  row.append(top, project, comment, actions);
  return row;
}

function toCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function exportReviewsCsv(reviews: Review[]) {
  const header = ["Name", "Project", "Rating", "Comment", "Status", "Date"];
  const rows = reviews.map((r) => [
    r.name,
    projectTitle(r.projectId),
    String(r.rating),
    r.comment,
    r.status,
    new Date(r.createdAt).toISOString(),
  ]);

  const csv = [header, ...rows].map((row) => row.map(toCsvField).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "reviews.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function loadAdminData() {
  const [reviewsRes, portfolioProjects] = await Promise.all([
    fetch("/api/reviews/admin-data", { headers: authHeaders() }),
    fetchPortfolio(),
  ]);

  projects = portfolioProjects;

  if (reviewsRes.status === 401) {
    adminRoot.hidden = true;
    unlockStatus.textContent = "Incorrect password.";
    unlockStatus.className = "review-form__status review-form__status--error";
    return;
  }

  if (!reviewsRes.ok) {
    unlockStatus.textContent = "Could not load reviews.";
    unlockStatus.className = "review-form__status review-form__status--error";
    return;
  }

  const data = await reviewsRes.json();
  const reviews: Review[] = Array.isArray(data.reviews) ? data.reviews : [];
  const totalViews: number = typeof data.totalViews === "number" ? data.totalViews : 0;

  unlockForm.hidden = true;
  adminRoot.hidden = false;

  renderStats(reviews, totalViews);

  reviewsSectionEl.replaceChildren();

  const pending = reviews.filter((r) => r.status === "pending");
  const approved = reviews.filter((r) => r.status === "approved");

  const pendingHeading = document.createElement("h2");
  pendingHeading.className = "reviews-heading";
  pendingHeading.textContent = `Pending (${pending.length})`;
  reviewsSectionEl.appendChild(pendingHeading);

  if (pending.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reviews-empty";
    empty.textContent = "Nothing waiting on review.";
    reviewsSectionEl.appendChild(empty);
  } else {
    for (const review of pending) {
      reviewsSectionEl.appendChild(
        buildReviewRow(review, (action, event) => {
          if (action === "approve") burstConfetti(event.clientX, event.clientY);
          void moderate(review.id, action);
        }),
      );
    }
  }

  const approvedHeading = document.createElement("h2");
  approvedHeading.className = "reviews-heading";
  approvedHeading.style.marginTop = "32px";
  approvedHeading.textContent = `Approved (${approved.length})`;
  reviewsSectionEl.appendChild(approvedHeading);

  if (approved.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reviews-empty";
    empty.textContent = "Nothing approved yet.";
    reviewsSectionEl.appendChild(empty);
  } else {
    for (const review of approved) {
      reviewsSectionEl.appendChild(buildReviewRow(review, (action) => void moderate(review.id, action)));
    }
  }

  exportCsvBtn.onclick = () => exportReviewsCsv(reviews);

  renderPortfolioAdminList();
  void refreshPassportAdmin();
}

async function moderate(id: string, action: "approve" | "reject") {
  await fetch("/api/reviews/moderate", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ id, action }),
  });
  void loadAdminData();
}

// --- Portfolio management ---

function renderPortfolioAdminList() {
  portfolioListEl.replaceChildren();

  for (const project of projects) {
    const row = document.createElement("div");
    row.className = "admin-review";

    const title = document.createElement("span");
    title.className = "review-card__name";
    title.textContent = project.title;

    const slug = document.createElement("span");
    slug.className = "admin-review__project";
    slug.textContent = `/project/${project.slug}`;

    const actions = document.createElement("div");
    actions.className = "admin-review__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "admin-review__approve";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEditingProject(project));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "admin-review__reject";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => void deleteProject(project.slug));

    actions.append(editBtn, deleteBtn);
    row.append(title, slug, actions);
    portfolioListEl.appendChild(row);
  }
}

function startEditingProject(project: Project) {
  editingSlug = project.slug;
  portfolioFormMode.textContent = `Editing "${project.title}"`;
  portfolioFields.slug.value = project.slug;
  portfolioFields.slug.disabled = true;
  portfolioFields.title.value = project.title;
  portfolioFields.description.value = project.description;
  portfolioFields.detail.value = project.detail;
  portfolioFields.image.value = project.image;
  portfolioFields.url.value = project.url === "#" ? "" : project.url;
  portfolioFormCancel.hidden = false;
  portfolioForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetPortfolioForm() {
  editingSlug = null;
  portfolioForm.reset();
  portfolioFields.slug.disabled = false;
  portfolioFormMode.textContent = "Add a new project";
  portfolioFormCancel.hidden = true;
}

async function deleteProject(slug: string) {
  await fetch("/api/portfolio/delete", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ slug }),
  });
  projects = await fetchPortfolio();
  renderPortfolioAdminList();
}

portfolioFormCancel.addEventListener("click", resetPortfolioForm);

portfolioForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(portfolioForm);

  portfolioFormStatus.textContent = "Saving…";
  portfolioFormStatus.className = "review-form__status";

  void fetch("/api/portfolio/save", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      slug: editingSlug ?? String(formData.get("slug") ?? ""),
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      detail: String(formData.get("detail") ?? ""),
      image: String(formData.get("image") ?? ""),
      url: String(formData.get("url") ?? ""),
    }),
  })
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(async ({ ok, data }) => {
      if (!ok) {
        portfolioFormStatus.textContent = data.error ?? "Could not save project.";
        portfolioFormStatus.className = "review-form__status review-form__status--error";
        return;
      }
      portfolioFormStatus.textContent = "Saved!";
      portfolioFormStatus.className = "review-form__status review-form__status--ok";
      projects = await fetchPortfolio();
      renderPortfolioAdminList();
      resetPortfolioForm();
    })
    .catch(() => {
      portfolioFormStatus.textContent = "Could not reach the server.";
      portfolioFormStatus.className = "review-form__status review-form__status--error";
    });
});

// --- Passport management ---

let passportItems: PassportItem[] = [];
let pickedResult: PassportSearchResult | null = null;
let editingPassportId: string | null = null;

const passportListEl = document.getElementById("passport-admin-list")!;
const passportForm = document.getElementById("passport-form") as HTMLFormElement;
const passportFormMode = document.getElementById("passport-form-mode")!;
const passportFormStatus = document.getElementById("passport-form-status")!;
const passportFormCancel = document.getElementById("passport-form-cancel") as HTMLButtonElement;
const passportSearchRow = document.getElementById("passport-search-row")!;
const passportSearchBtn = document.getElementById("passport-search-btn") as HTMLButtonElement;
const passportResultsEl = document.getElementById("passport-results")!;
const passportPickedEl = document.getElementById("passport-picked")!;

const passportFields = {
  type: passportForm.elements.namedItem("type") as HTMLSelectElement,
  query: passportForm.elements.namedItem("query") as HTMLInputElement,
  note: passportForm.elements.namedItem("note") as HTMLTextAreaElement,
  featured: passportForm.elements.namedItem("featured") as HTMLInputElement,
};

function setPassportStatus(text: string, tone?: "ok" | "error") {
  passportFormStatus.textContent = text;
  passportFormStatus.className = `review-form__status${tone ? ` review-form__status--${tone}` : ""}`;
}

function setShelf(shelf: Shelf) {
  const radio = passportForm.querySelector<HTMLInputElement>(`input[name="shelf"][value="${shelf}"]`);
  if (radio) radio.checked = true;
}

function buildResultText(title: string, subtitle: string): HTMLElement {
  const text = document.createElement("span");
  text.style.minWidth = "0";
  const titleEl = document.createElement("span");
  titleEl.className = "passport-result__title";
  titleEl.textContent = title;
  const subtitleEl = document.createElement("span");
  subtitleEl.className = "passport-result__subtitle";
  subtitleEl.textContent = subtitle;
  text.append(titleEl, subtitleEl);
  return text;
}

function showPicked(result: PassportSearchResult) {
  pickedResult = result;
  passportPickedEl.replaceChildren(
    buildCover(result, "passport-picked__cover"),
    buildResultText(result.title, [TYPE_LABEL[result.type], result.subtitle].filter(Boolean).join(" · ")),
  );
  passportPickedEl.hidden = false;
  passportResultsEl.hidden = true;
}

function renderSearchResults(results: PassportSearchResult[]) {
  passportResultsEl.replaceChildren();
  passportResultsEl.hidden = false;

  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reviews-empty";
    empty.textContent = "No matches — try a different spelling or type.";
    passportResultsEl.appendChild(empty);
    return;
  }

  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "passport-result";
    button.setAttribute("role", "option");
    button.append(buildCover(result, "passport-result__cover"), buildResultText(result.title, result.subtitle));
    button.addEventListener("click", () => {
      // Picking something that's already in the passport edits it instead of duplicating.
      const existing = passportItems.find((item) => item.id === passportId(result));
      if (existing) {
        startEditingPassportItem(existing);
        setPassportStatus("Already in your passport — editing it instead.");
        return;
      }
      showPicked(result);
      setPassportStatus("");
      passportFields.note.focus();
    });
    passportResultsEl.appendChild(button);
  }
}

async function runPassportSearch() {
  const query = passportFields.query.value.trim();
  if (!query) return;
  const type = passportFields.type.value as PassportType;

  setPassportStatus("Searching…");
  passportSearchBtn.disabled = true;
  try {
    const params = new URLSearchParams({ type, q: query });
    const res = await fetch(`/api/passport/search?${params}`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPassportStatus(data.error ?? "Search failed.", "error");
      return;
    }
    setPassportStatus("");
    renderSearchResults(Array.isArray(data.results) ? data.results : []);
  } catch {
    setPassportStatus("Could not reach the server.", "error");
  } finally {
    passportSearchBtn.disabled = false;
  }
}

function renderPassportAdminList() {
  passportListEl.replaceChildren();

  if (passportItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reviews-empty";
    empty.textContent = "Nothing in your passport yet.";
    passportListEl.appendChild(empty);
    return;
  }

  for (const item of passportItems) {
    const row = document.createElement("div");
    row.className = "admin-review passport-admin-row";

    const text = document.createElement("div");
    text.className = "passport-admin-row__text";
    const title = document.createElement("span");
    title.className = "review-card__name";
    title.textContent = item.featured ? `★ ${item.title}` : item.title;
    const meta = document.createElement("span");
    meta.className = "admin-review__project";
    meta.textContent = `${TYPE_LABEL[item.type]} · ${item.shelf === "current" ? "Currently" : "All-time"}`;
    text.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "admin-review__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "admin-review__approve";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEditingPassportItem(item));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "admin-review__reject";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (window.confirm(`Remove "${item.title}" from your passport?`)) void deletePassportItem(item.id);
    });

    actions.append(editBtn, deleteBtn);
    row.append(buildCover(item, "passport-admin-row__cover"), text, actions);
    passportListEl.appendChild(row);
  }
}

async function refreshPassportAdmin() {
  passportItems = await fetchPassport();
  renderPassportAdminList();
}

function startEditingPassportItem(item: PassportItem) {
  editingPassportId = item.id;
  passportFormMode.textContent = `Editing "${item.title}"`;
  passportSearchRow.hidden = true;
  showPicked({
    type: item.type,
    externalId: item.id.slice(item.type.length + 1),
    title: item.title,
    subtitle: item.subtitle,
    cover: item.cover,
    url: item.url,
  });
  passportFields.note.value = item.note;
  passportFields.featured.checked = item.featured;
  setShelf(item.shelf);
  passportFormCancel.hidden = false;
  passportForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetPassportForm() {
  editingPassportId = null;
  pickedResult = null;
  const keepType = passportFields.type.value;
  passportForm.reset();
  passportFields.type.value = keepType;
  passportFormMode.textContent = "Add something";
  passportSearchRow.hidden = false;
  passportResultsEl.hidden = true;
  passportResultsEl.replaceChildren();
  passportPickedEl.hidden = true;
  passportPickedEl.replaceChildren();
  passportFormCancel.hidden = true;
}

async function deletePassportItem(id: string) {
  await fetch("/api/passport/items", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action: "delete", id }),
  });
  if (editingPassportId === id) resetPassportForm();
  await refreshPassportAdmin();
}

passportSearchBtn.addEventListener("click", () => void runPassportSearch());
passportFields.query.addEventListener("keydown", (event) => {
  // Enter in the search box searches — it shouldn't submit the save form.
  if (event.key === "Enter") {
    event.preventDefault();
    void runPassportSearch();
  }
});
passportFormCancel.addEventListener("click", () => {
  resetPassportForm();
  setPassportStatus("");
});

passportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pickedResult) {
    setPassportStatus("Search for something and pick a result first.", "error");
    return;
  }

  const formData = new FormData(passportForm);
  const item = {
    id: passportId(pickedResult),
    type: pickedResult.type,
    title: pickedResult.title,
    subtitle: pickedResult.subtitle,
    cover: pickedResult.cover,
    url: pickedResult.url,
    note: String(formData.get("note") ?? ""),
    shelf: (formData.get("shelf") === "alltime" ? "alltime" : "current") as Shelf,
    featured: passportFields.featured.checked,
  };

  setPassportStatus("Saving…");
  void fetch("/api/passport/items", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action: "save", item }),
  })
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(async ({ ok, data }) => {
      if (!ok) {
        setPassportStatus(data.error ?? "Could not save.", "error");
        return;
      }
      setPassportStatus("Stamped!", "ok");
      resetPassportForm();
      await refreshPassportAdmin();
    })
    .catch(() => setPassportStatus("Could not reach the server.", "error"));
});

unlockForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(unlockForm);
  password = String(formData.get("password") ?? "");
  unlockStatus.textContent = "Checking…";
  unlockStatus.className = "review-form__status";
  void loadAdminData();
});
