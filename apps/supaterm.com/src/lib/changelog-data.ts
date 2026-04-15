type ChangeCategory = "new" | "improvements" | "fixes";

type ChangeSection = {
  category: ChangeCategory;
  items: string[];
};

type ChangelogEntry = {
  version: string;
  date: string;
  title: string;
  description?: string;
  image?: string;
  sections: ChangeSection[];
};

const changelogData: ChangelogEntry[] = [
  {
    version: "v1.0.3",
    date: "2026-04-12",
    title: "Onboarding and defaults",
    sections: [
      {
        category: "improvements",
        items: [
          "Dark is now the default appearance",
          "Refined onboarding setup copy",
          "Simplified onboarding output",
        ],
      },
      {
        category: "fixes",
        items: ["Fixed Pi onboarding command"],
      },
    ],
  },
  {
    version: "v1.0.2",
    date: "2026-04-12",
    title: "CLI improvements",
    sections: [
      {
        category: "improvements",
        items: ["Renamed sp shell flag to script"],
      },
    ],
  },
  {
    version: "v1.0.1",
    date: "2026-04-12",
    title: "Help menu and bug fixes",
    sections: [
      {
        category: "new",
        items: ["GitHub issue action in Help menu and command palette"],
      },
      {
        category: "fixes",
        items: ["Fixed duplicate Ghostty link opens"],
      },
    ],
  },
  {
    version: "v1.0.0",
    date: "2026-04-12",
    title: "Supaterm 1.0",
    description: "The first stable release of Supaterm.",
    sections: [
      {
        category: "new",
        items: [
          "Spaces, tabs, and split panes",
          "Full agent integration with Claude Code, Codex, and Pi",
          "CLI and agent skills via npx",
          "Native macOS app built with libghostty",
        ],
      },
    ],
  },
];

export { changelogData };
export type { ChangeCategory, ChangelogEntry, ChangeSection };
