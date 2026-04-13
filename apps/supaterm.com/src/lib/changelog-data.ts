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
    title: "Bug fixes and polish",
    changes: [
      "Fixed agent status not updating when pane is backgrounded",
      "Improved split pane resize handle visibility",
      "Fixed CLI skill installation path on Apple Silicon",
    ],
  },
  {
    version: "v1.0.2",
    date: "2026-04-12",
    title: "Agent notification improvements",
    changes: [
      "Pane glow effect now pulses when agent needs attention",
      "Added sound notification option for agent events",
      "Fixed hover preview positioning on ultra-wide displays",
    ],
  },
  {
    version: "v1.0.1",
    date: "2026-04-12",
    title: "Performance and stability",
    changes: [
      "Reduced memory usage for long-running sessions",
      "Fixed tab pinning not persisting across restarts",
      "Improved libghostty rendering performance",
    ],
  },
  {
    version: "v1.0.0",
    date: "2026-04-12",
    title: "Supaterm 1.0",
    changes: [
      "Stable release of Supaterm",
      "Spaces, tabs, and split panes",
      "Full agent integration with Claude Code, Codex, and Pi",
      "CLI and agent skills via npx",
      "Native macOS app built with libghostty",
    ],
  },
  {
    version: "v0.7.1",
    date: "2026-04-12",
    title: "Pre-release fixes",
    changes: [
      "Fixed crash on macOS when closing last tab in a space",
      "Improved sidebar agent status indicators",
    ],
  },
  {
    version: "v0.7.0",
    date: "2026-04-09",
    title: "Spaces and agent sidebar",
    changes: [
      "Introduced Spaces for organizing groups of tabs",
      "New sidebar showing running agent statuses",
      "Initial Claude Code and Codex integration",
    ],
  },
];

export { changelogData };
export type { ChangelogEntry };
