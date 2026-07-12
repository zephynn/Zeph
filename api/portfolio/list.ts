import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

interface Project {
  slug: string;
  title: string;
  description: string;
  detail: string;
  image: string;
  url: string;
}

// Shown until real projects are saved via /admin — the Redis hash "portfolio"
// starts empty, so this is the only content until it has at least one entry.
const DEFAULT_PROJECTS: Project[] = [
  {
    slug: "project-one",
    title: "Project One",
    description: "Add a short description of this project here.",
    detail:
      "Add a longer write-up of this project here — what it is, what you built, what you're proud of. Separate paragraphs with a blank line.",
    image: "",
    url: "#",
  },
  {
    slug: "project-two",
    title: "Project Two",
    description: "Add a short description of this project here.",
    detail:
      "Add a longer write-up of this project here — what it is, what you built, what you're proud of. Separate paragraphs with a blank line.",
    image: "",
    url: "#",
  },
  {
    slug: "project-three",
    title: "Project Three",
    description: "Add a short description of this project here.",
    detail:
      "Add a longer write-up of this project here — what it is, what you built, what you're proud of. Separate paragraphs with a blank line.",
    image: "",
    url: "#",
  },
];

/** Public — the portfolio grid, project detail pages, and reviews feed all read from here. */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    res.status(200).json({ projects: DEFAULT_PROJECTS });
    return;
  }

  try {
    const redis = new Redis({ url: kvUrl, token: kvToken });
    const all = await redis.hgetall<Record<string, string>>("portfolio");

    if (!all || Object.keys(all).length === 0) {
      res.status(200).json({ projects: DEFAULT_PROJECTS });
      return;
    }

    const projects: Project[] = Object.values(all)
      .map((raw) => {
        try {
          return typeof raw === "string" ? (JSON.parse(raw) as Project) : (raw as unknown as Project);
        } catch {
          return null;
        }
      })
      .filter((p): p is Project => p !== null);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ projects });
  } catch {
    res.status(200).json({ projects: DEFAULT_PROJECTS });
  }
}
