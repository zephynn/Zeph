export const config = {
  displayName: "zephyn",
  tagline: "Roblox Developer",
  handles: ["zephyn.fbx", "zephynnn", "zeph.dev"],

  // IANA timezone used for the live local-time pill.
  timezone: "Europe/London",

  discord: {
    // Only used for the live Lanyard presence widget in the hero — the
    // "Pages" links group no longer includes a Discord row.
    userId: "1491487646424498357",
  },

  youtube: {
    channelId: "UCXbuZuNYhCbLk83_uJ3WI_g",
    url: "https://www.youtube.com/channel/UCXbuZuNYhCbLk83_uJ3WI_g",
  },

  roblox: {
    // TODO: replace with your actual Roblox profile URL (e.g. https://www.roblox.com/users/<id>/profile)
    url: "https://www.roblox.com/users/0/profile",
  },

  tiktok: {
    url: "https://www.tiktok.com/@zeph.dev",
  },

  // Portfolio projects now live in Redis, editable at /admin — see
  // api/portfolio/*.ts and src/lib/portfolio.ts. api/portfolio/list.ts has
  // the placeholder defaults shown until you save your first real project.
} as const;
