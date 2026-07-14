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
  video?: string;
  sections: ChangeSection[];
};

const changelogData: ChangelogEntry[] = [
  {
    version: "v26.3.1",
    date: "2026-07-13",
    title: "💙 Final Beta Hotfix",
    description:
      "This hotfix sharpens Codex subagent updates, restores neutral light chrome, and keeps the final Beta message available until you dismiss it.",
    sections: [
      {
        category: "improvements",
        items: [
          "Codex subagent rows now show their assigned task immediately, then switch to their latest response as work progresses",
        ],
      },
      {
        category: "fixes",
        items: [
          "Codex parent and child activity no longer overwrite one another in the agent panel",
          "Light mode chrome no longer carries a colored tint",
          "The final Beta announcement now remains visible across relaunches and hotfix updates until dismissed",
        ],
      },
    ],
  },
  {
    version: "v26.3.0",
    date: "2026-07-12",
    title: "💙 Final Beta Release",
    description:
      "The final Supaterm Beta release brings a more reliable terminal, accurate coding-agent activity, and refined sidebar polish before the app’s next chapter.",
    sections: [
      {
        category: "new",
        items: [
          "Codex subagents now appear by their assigned nicknames in the agent panel",
          "Terminal configuration, renderer, and surface failures now show actionable recovery UI",
        ],
      },
      {
        category: "improvements",
        items: [
          "Normal quits now consistently offer choices for handling running terminal sessions",
          "Refined sidebar colors, selection states, indicators, and notification previews",
          "Clipboard reads, writes, and unsafe pastes now require confirmation from the originating terminal",
        ],
      },
      {
        category: "fixes",
        items: [
          "Agent plans now remain visible and usage-limit failures stop showing as working",
          "Restored agent sessions no longer attach to reused processes or accept stale lifecycle events",
          "Terminal focus, shortcuts, and split interactions now stay aligned across windows",
        ],
      },
    ],
  },
  {
    version: "v26.2.0",
    date: "2026-07-08",
    title: "🌈 Space Themes",
    description:
      "Every terminal space can now carry its own theme, and you can read and write Supaterm settings straight from the sp CLI.",
    sections: [
      {
        category: "new",
        items: [
          "Added 8 curated space themes, chosen per space when you create or edit a space",
          "Added sp config commands to read and write settings from the terminal: sp config list, get, set, reset, and path",
        ],
      },
      {
        category: "improvements",
        items: [
          "Supaterm now warns before closing a terminal space with live sessions",
          "Renamed the sp space close command to sp space destroy",
        ],
      },
      {
        category: "fixes",
        items: [
          "The Claude sidebar spinner now stays active through long tool calls instead of vanishing mid-turn",
          "Restore Terminal Layout now works even when quitting terminates live sessions",
          "Fork Session no longer freezes the agent panel for forked Claude sessions",
          "Claude panel tasks now render in a stable task order",
          "The agent panel surface is now fully opaque",
        ],
      },
    ],
  },
  {
    version: "v26.1.0",
    date: "2026-07-02",
    title: "🎨 Color Tuning",
    description: "Supaterm now has calmer sidebar colors across light and dark mode.",
    sections: [
      {
        category: "new",
        items: [
          "Added a copyable Homebrew install command to the website",
          "Added versioned download URLs with checksum verification for release assets",
        ],
      },
      {
        category: "improvements",
        items: [
          "Refined sidebar colors, selected tab pills, hover and pressed states, and tab drag previews",
          "Agent badges now use cleaner monochrome icons with fixed spacing",
          "Agent goal rows now use a dedicated target icon in the agent panel",
          "Update and announcement cards now sit more cleanly in the sidebar",
        ],
      },
      {
        category: "fixes",
        items: [
          "Terminal panes now regain focus when their window activates",
          "Fixed clipped selected-tab glows, overlapping tab badges, and quit confirmation button sizing",
          "Filtered fork pull requests out of the agent panel",
        ],
      },
    ],
  },
  {
    version: "v26.0.0",
    date: "2026-06-18",
    title: "🚀 Agent workflow polish",
    description:
      "Supaterm now uses yearly release numbers, with faster agent panels and more dependable tab-launch automation.",
    sections: [
      {
        category: "new",
        items: [
          "Added pane health and wait-ready commands so tab launchers can wait until a pane can receive input",
          "Bundled the Supaterm tab launcher for coding-agent workflows",
        ],
      },
      {
        category: "improvements",
        items: [
          "Pull request status in the agent panel now refreshes in batches, avoids stale cache results, and preserves the last known status during temporary refresh misses",
          "New tabs now always open at the end of the tab strip",
          "Branch names can now be copied directly from the agent panel",
          "Coding-agent setup now installs the shared Supaterm skill before enabling agents",
          "Agent notification previews in the sidebar now stay to two lines",
        ],
      },
      {
        category: "fixes",
        items: [
          "Stopped agent sessions now clear panel progress instead of leaving stale rows visible",
          "Agent running detection now waits longer before deciding a session is idle",
          "Quit confirmation buttons now keep their labels on one line",
          "Coding-agent badges now stack with the active badge in front",
        ],
      },
    ],
  },
  {
    version: "v1.3.7",
    date: "2026-06-15",
    title: "🛠️ Session reliability fixes",
    sections: [
      {
        category: "improvements",
        items: [
          "Agent progress now tracks active goals from live sessions",
          "Bundled Supaterm skills now refresh automatically on app launch",
          "The website hero and share image now use the latest app screenshot",
        ],
      },
      {
        category: "fixes",
        items: [
          "Pinned terminal panes no longer disappear after OSC 8 hyperlink output",
          "Forked agent panes now keep the correct session routing and progress state",
          "sp socket requests now expire cleanly instead of leaving the daemon busy",
          "Terminal windows now restore their saved frame on relaunch",
          "Path-like sidebar tab titles now truncate from the middle",
        ],
      },
    ],
  },
  {
    version: "v1.3.6",
    date: "2026-06-02",
    title: "🛠️ Pinned tab hotfixes",
    sections: [],
  },
  {
    version: "v1.3.5",
    date: "2026-06-02",
    title: "🛠️ Login shell startup fix",
    sections: [],
  },
  {
    version: "v1.3.4",
    date: "2026-06-02",
    title: "🎛️ Agent Panel",
    description:
      "There is now an agent panel showing Git, PR status, server opened by the agent, and some other actions.",
    video: "/changelog/agent-session-polish.mp4",
    sections: [
      {
        category: "new",
        items: ["Fork supported agent sessions and copy session IDs from the agent panel"],
      },
      {
        category: "fixes",
        items: [
          "zmx startup now preserves shell integration and working-directory tracking",
          "Splitting panes while search is open now keeps focus on the new pane",
        ],
      },
    ],
  },
  {
    version: "v1.3.3",
    date: "2026-05-26",
    title: "🛠️ More zmx hotfixes",
    description:
      "Real fix this time, sorry. Persisted zmx panes now stay attached when wrapped processes exit.",
    sections: [],
  },
  {
    version: "v1.3.2",
    date: "2026-05-26",
    title: "🛠️ Some zmx hotfixes",
    sections: [],
  },
  {
    version: "v1.3.1",
    date: "2026-05-22",
    title: "🛠️ Session & Update Polish",
    description:
      "A small bug-fix release for smoother persisted sessions, clearer update prompts, and more reliable coding-agent activity. Updates can now install right away or wait until the next restart without losing terminal sessions.",
    sections: [],
  },
  {
    version: "v1.3.0",
    date: "2026-05-21",
    title: "🧭 Agent Panel & Persistence",
    description:
      "Agent work is visible per pane now, and terminal sessions can survive quit and relaunch.",
    image: "/changelog/demo-agent-panel.png",
    sections: [
      {
        category: "new",
        items: [
          "Added a per-pane agent panel with task progress, branch details, pull request status, checks, web-search sources, and localhost links",
          "Added zmx-backed session persistence so tabs, splits, working directories, titles, and agent presence can reconnect after quit and relaunch",
          "Added Finder services for opening selected files or folders in a new Supaterm tab or window",
        ],
      },
      {
        category: "improvements",
        items: [
          "Pinned tabs now auto-save their layout, selected state, titles, and working directories",
          "Coding-agent badges now stack in the sidebar and stay visible across active tabs and splits",
          "The agent panel can be toggled from settings, the menu, and Command-I",
          "Quit confirmation now lets you preserve or terminate persisted sessions",
        ],
      },
      {
        category: "fixes",
        items: [
          "Older saved terminal layouts now restore instead of falling back to a blank layout",
          "Managed socket and zmx session paths now fall back safely when paths are too long",
          "Session cleanup now only targets the current Supaterm instance",
          "New installs now default close confirmation to Always",
        ],
      },
    ],
  },
  {
    version: "v1.2.2",
    date: "2026-05-09",
    title: "🪝 Fix Codex Hooks",
    sections: [
      {
        category: "fixes",
        items: [
          "Installed Codex hooks no longer ask for review again after Supaterm refreshes them on launch",
        ],
      },
    ],
  },
  {
    version: "v1.2.1",
    date: "2026-05-08",
    title: "May fixes",
    sections: [
      {
        category: "fixes",
        items: [
          "Pinned tabs now stay pinned when closed, and restore their saved working directories when reopened",
          "Dormant pinned tabs no longer respawn unexpectedly",
          "Closing the last pane in a pinned tab no longer tries to close the window",
          "Image-only pasteboards now paste as a usable temporary PNG path",
          "Coding-agent state now clears when the foreground command finishes",
          "Installed coding-agent hooks are refreshed on app launch",
        ],
      },
    ],
  },
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
