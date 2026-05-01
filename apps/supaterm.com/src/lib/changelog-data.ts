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
    version: "v1.2.0",
    date: "2026-05-01",
    title: "Genie",
    description: "We got a new logo! Thanks to Genie",
    sections: [
      {
        category: "new",
        items: [
          "Respect Ghostty global terminal visibility keybinds,example: keybind = global:super+shift+s=toggle_visibility",
          "Show a amber dot on the toggle sidebar icon if you are in collapsed mode",
        ],
      },
      {
        category: "improvements",
        items: [
          "Split panes now dim inactive panes, hover resize dividers more cleanly, and restore focus after split zoom",
          "settings.toml now stays sparse and only writes changed settings",
          "Terminal UI motion now respects macOS Reduce Motion",
        ],
      },
      {
        category: "fixes",
        items: [
          "Coding-agent setup now shows install failure logs and handles more package sources",
        ],
      },
    ],
  },
  {
    version: "v1.1.1",
    date: "2026-04-17",
    title: "Lightmode blindness",
    description: "Some small UI improvements mostly",
    sections: [
      {
        category: "improvements",
        items: [
          "Show pane titles in sp ls",
          "Show terminal size and font size while zooming",
          "Stop surfacing restart update actions in the command palette",
        ],
      },
      {
        category: "fixes",
        items: [
          "Fixed automatic appearance so terminal windows follow macOS light and dark changes",
        ],
      },
    ],
  },
  {
    version: "v1.1.0",
    date: "2026-04-15",
    title: "The Ethan Release",
    description:
      "Full command palette parity with Ghostty, TOML settings, tab pinning from the CLI, and a round of terminal reliability fixes.",
    sections: [
      {
        category: "new",
        items: ["Pin tabs from the CLI with sp tab pin/unpin"],
      },
      {
        category: "improvements",
        items: [
          "Expanded the list of items in command pallete",
          "Settings is now in TOML @ ~/.config/supaterm/settings.toml - way easier to read than JSON",
          "Codex transcript parsing to make the loading indicator more reliable",
        ],
      },
      {
        category: "fixes",
        items: [
          "Fixed a memory hog due to having too many IOSurfaceKit for non-showing panes",
          "Fixed a problem where app doesn't start with the correct theme",
          "Fixed terminal link CMD + clicking",
        ],
      },
    ],
  },
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
