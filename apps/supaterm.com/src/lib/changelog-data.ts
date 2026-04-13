type ChangelogEntry = {
  version: string;
  date: string;
  title: string;
  changes: string[];
};

const changelogData: ChangelogEntry[] = [
  {
    version: "v1.0.3",
    date: "2026-04-12",
    title: "Onboarding and defaults",
    changes: [
      "Make dark the default appearance",
      "Refine onboarding setup copy",
      "Fix Pi onboarding command",
      "Simplify onboarding output",
    ],
  },
  {
    version: "v1.0.2",
    date: "2026-04-12",
    title: "CLI improvements",
    changes: ["Rename sp shell flag to script"],
  },
  {
    version: "v1.0.1",
    date: "2026-04-12",
    title: "Help menu and bug fixes",
    changes: [
      "Add GitHub issue action to Help menu and command palette",
      "Fix duplicate Ghostty link opens",
    ],
  },
  {
    version: "v1.0.0",
    date: "2026-04-12",
    title: "Supaterm 1.0",
    changes: ["🚀 First stable release."],
  },
];

export { changelogData };
export type { ChangelogEntry };
