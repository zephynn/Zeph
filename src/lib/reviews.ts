export interface Review {
  id: string;
  projectId: string;
  name: string;
  rating: number;
  comment: string;
  status: "pending" | "approved";
  createdAt: number;
}

export async function fetchReviews(projectId?: string): Promise<Review[]> {
  try {
    const url = projectId ? `/api/reviews/list?projectId=${encodeURIComponent(projectId)}` : "/api/reviews/list";
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.reviews) ? data.reviews : [];
  } catch {
    return [];
  }
}

export interface SubmitReviewInput {
  projectId: string;
  name: string;
  rating: number;
  comment: string;
  website: string; // honeypot, must stay empty
}

export async function submitReview(input: SubmitReviewInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/reviews/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error ?? "Could not submit review" };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server" };
  }
}
