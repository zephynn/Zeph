export interface Project {
  slug: string;
  title: string;
  description: string;
  detail: string;
  image: string;
  url: string;
}

export async function fetchPortfolio(): Promise<Project[]> {
  try {
    const res = await fetch("/api/portfolio/list");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.projects) ? data.projects : [];
  } catch {
    return [];
  }
}
