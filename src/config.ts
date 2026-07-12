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

  // TODO: replace with your real projects. `slug` must be unique — it's used
  // in the URL (/project/<slug>) and to tag reviews to a specific project.
  // `image` can stay "" (shows a placeholder) or point at a file dropped in
  // /public (e.g. "/my-project.png"). `url` is an optional external link
  // (e.g. the actual Roblox game) shown as a button on the detail page —
  // leave it "#" to omit.
  portfolio: [
    {
      slug: "project-one",
      title: "Project One",
      description: "Add a short description of this project here.",
      detail: "Add a longer write-up of this project here — what it is, what you built, what you're proud of. Separate paragraphs with a blank line.",
      image: "",
      url: "#",
    },
    {
      slug: "project-two",
      title: "Project Two",
      description: "Add a short description of this project here.",
      detail: "Add a longer write-up of this project here — what it is, what you built, what you're proud of. Separate paragraphs with a blank line.",
      image: "",
      url: "#",
    },
    {
      slug: "project-three",
      title: "Project Three",
      description: "Add a short description of this project here.",
      detail: "Add a longer write-up of this project here — what it is, what you built, what you're proud of. Separate paragraphs with a blank line.",
      image: "",
      url: "#",
    },
  ],
} as const;
