import { PROJECT_ICONS } from "./generated/projectIcons.ts";
import type { ProjectIcon } from "./projectIcon.ts";

export { PROJECT_ICONS };
export type { ProjectIcon };

const PROJECT_ICONS_BY_NAME: ReadonlyMap<string, ProjectIcon> = new Map(
  PROJECT_ICONS.map((icon) => [icon.name, icon]),
);

function projectIconNamed(name: string): ProjectIcon {
  const icon = PROJECT_ICONS_BY_NAME.get(name);
  if (!icon) throw new Error(`icons.json does not offer the "${name}" project icon`);
  return icon;
}

export const DEFAULT_PROJECT_ICON = projectIconNamed("folder");

// Projects saved Lucide icon names before Supaterm switched icon sets. Names that
// match a project icon resolve as-is; these are the ones that changed.
const LEGACY_LUCIDE_NAMES: Readonly<Record<string, string>> = {
  "bar-chart": "chart-column",
  "bar-chart-3": "chart-column",
  "book-open-text": "book-open",
  "bot-message-square": "bot",
  "brain-circuit": "brain",
  "building-2": "building",
  "cake-slice": "cake",
  "chart-bar": "chart-column",
  clapperboard: "film",
  "cloud-cog": "cloud",
  "code-2": "code-xml",
  "database-zap": "database",
  dices: "dice",
  "dice-5": "dice",
  droplets: "droplet",
  "flask-conical": "flask",
  "flask-round": "flask",
  "flower-2": "flower",
  "folder-code": "folder",
  "folder-git-2": "folder-git",
  "gamepad-2": "gamepad",
  "globe-2": "earth",
  home: "house",
  "key-round": "key",
  "laptop-2": "laptop",
  "layers-2": "layers",
  "layers-3": "layers",
  leaf: "sprout",
  "line-chart": "chart-line",
  "message-square": "message-circle",
  "message-square-dashed": "message-square-more",
  "monitor-smartphone": "monitor",
  "mouse-pointer": "mouse",
  "music-2": "music",
  "music-4": "music",
  "notebook-pen": "notebook",
  orbit: "planet",
  "package-2": "package",
  "paintbrush-2": "paintbrush",
  "pie-chart": "chart-pie",
  "plug-2": "plug",
  "plug-zap": "plug",
  "server-cog": "server",
  "settings-2": "settings",
  "shield-check": "shield",
  sparkle: "sparkles",
  "tablet-smartphone": "smartphone",
  "terminal-square": "square-terminal",
  "tree-deciduous": "tree",
  "tree-palm": "tree",
  "tree-pine": "tree",
  trees: "tree",
  "wand-2": "wand-sparkles",
};

interface SavedProjectIcon {
  readonly kind: "icon" | "lucide";
  readonly name: string;
}

// A saved name this client does not offer, from a newer client or a retired Lucide
// icon, draws the default icon in the saved color.
export function resolveProjectIcon(saved: SavedProjectIcon): ProjectIcon {
  const name =
    saved.kind === "lucide" ? (LEGACY_LUCIDE_NAMES[saved.name] ?? saved.name) : saved.name;
  return PROJECT_ICONS_BY_NAME.get(name) ?? DEFAULT_PROJECT_ICON;
}
