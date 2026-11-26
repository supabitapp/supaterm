import { ProjectMonogramText } from "@supaterm/contracts";
import { PROJECT_ICONS, type ProjectIcon } from "@supaterm/icons/project";
import * as Schema from "effect/Schema";
export { PROJECT_ICON_COLORS, projectIconColorClassName } from "./projectIconColors";

const isProjectMonogramText = Schema.is(ProjectMonogramText);

export const PROJECT_EMOJIS: ReadonlyArray<{ readonly emoji: string; readonly label: string }> = [
  { emoji: "💻", label: "Computer" },
  { emoji: "🛠️", label: "Tools" },
  { emoji: "🚀", label: "Rocket" },
  { emoji: "🤖", label: "Robot" },
  { emoji: "✨", label: "Sparkles" },
  { emoji: "⚡", label: "Lightning" },
  { emoji: "🌐", label: "Web" },
  { emoji: "📱", label: "Mobile" },
  { emoji: "🖥️", label: "Desktop" },
  { emoji: "⌨️", label: "Keyboard" },
  { emoji: "⚙️", label: "Gear" },
  { emoji: "🗄️", label: "Database" },
  { emoji: "☁️", label: "Cloud" },
  { emoji: "📦", label: "Package" },
  { emoji: "📚", label: "Books" },
  { emoji: "🧪", label: "Test tube" },
  { emoji: "🔒", label: "Lock" },
  { emoji: "🎮", label: "Game" },
  { emoji: "🎵", label: "Music" },
  { emoji: "🎬", label: "Movie" },
  { emoji: "🖼️", label: "Picture" },
  { emoji: "🛍️", label: "Shopping" },
  { emoji: "🔥", label: "Fire" },
  { emoji: "💡", label: "Idea" },
  { emoji: "🧩", label: "Puzzle" },
  { emoji: "📊", label: "Chart" },
  { emoji: "🧠", label: "Brain" },
  { emoji: "🦄", label: "Unicorn" },
  { emoji: "🐙", label: "Octopus" },
  { emoji: "🌱", label: "Seedling" },
];

export function filterProjectIcons(query: string): ReadonlyArray<ProjectIcon> {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (terms.length === 0) return PROJECT_ICONS;
  return PROJECT_ICONS.filter((icon) =>
    terms.every((term) => icon.name.includes(term) || icon.keywords.includes(term)),
  );
}

// The server also rejects monograms longer than two graphemes (ProjectCommands.ts).
export function isValidProjectMonogram(text: string): boolean {
  if (!isProjectMonogramText(text)) return false;
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  return Array.from(segments).length <= 2;
}

export function firstEmoji(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed);
  const segment = segments[Symbol.iterator]().next().value?.segment;
  const isFlag = /^\p{Regional_Indicator}{2}$/u.test(segment ?? "");
  const isKeycap = /^[#*0-9]\uFE0F?\u20E3$/u.test(segment ?? "");
  if (!segment || (!/\p{Extended_Pictographic}/u.test(segment) && !isFlag && !isKeycap)) {
    return null;
  }
  return segment;
}
