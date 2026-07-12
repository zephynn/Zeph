export const config = {
  displayName: "zephyn",
  tagline: "Roblox Developer",
  handles: ["zephyn.fbx", "zephynnn", "zeph.dev"],

  // IANA timezone used for the live local-time pill.
  timezone: "Europe/London",

  discord: {
    // Only used for the live Lanyard presence widget in the hero — the
    // "Pages" links group no longer includes a Discord row.
    userId: "1524022628744954017",
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

  // TODO: replace with your real projects — title, a short description,
  // an image (drop files in /public and reference them as "/your-file.png"),
  // and the link each card should open.
  portfolio: [
    {
      title: "Project One",
      description: "Add a short description of this project here.",
      image: "",
      url: "#",
    },
    {
      title: "Project Two",
      description: "Add a short description of this project here.",
      image: "",
      url: "#",
    },
    {
      title: "Project Three",
      description: "Add a short description of this project here.",
      image: "",
      url: "#",
    },
  ],
} as const;
