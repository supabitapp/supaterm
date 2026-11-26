import { ProjectMonogramText } from "@supaterm/contracts";
import { PROJECT_ICONS, type ProjectIcon } from "@supaterm/icons/project";
import * as Schema from "effect/Schema";
export { PROJECT_ICON_COLORS, projectIconColorClassName } from "./projectIconColors";
import { msg } from "gt-react";

const isProjectMonogramText = Schema.is(ProjectMonogramText);

export const PROJECT_EMOJIS: ReadonlyArray<{ readonly emoji: string; readonly label: string }> = [
  { emoji: "💻", label: msg("Computer", { $context: "emoji name, project icon" }) },
  { emoji: "🛠️", label: msg("Tools", { $context: "emoji name, project icon" }) },
  { emoji: "🚀", label: msg("Rocket", { $context: "emoji name, project icon" }) },
  { emoji: "🤖", label: msg("Robot", { $context: "emoji name, project icon" }) },
  { emoji: "✨", label: msg("Sparkles", { $context: "emoji name, project icon" }) },
  { emoji: "⚡", label: msg("Lightning", { $context: "emoji name, project icon" }) },
  { emoji: "🌐", label: msg("Web", { $context: "emoji name, project icon" }) },
  { emoji: "📱", label: msg("Mobile", { $context: "emoji name, project icon" }) },
  { emoji: "🖥️", label: msg("Desktop", { $context: "emoji name, project icon" }) },
  { emoji: "⌨️", label: msg("Keyboard", { $context: "emoji name, project icon" }) },
  { emoji: "⚙️", label: msg("Gear", { $context: "emoji name, project icon" }) },
  { emoji: "🗄️", label: msg("Database", { $context: "emoji name, project icon" }) },
  { emoji: "☁️", label: msg("Cloud", { $context: "emoji name, project icon" }) },
  { emoji: "📦", label: msg("Package", { $context: "emoji name, project icon" }) },
  { emoji: "📚", label: msg("Books", { $context: "emoji name, project icon" }) },
  { emoji: "🧪", label: msg("Test tube", { $context: "emoji name, project icon" }) },
  { emoji: "🔒", label: msg("Lock", { $context: "emoji name, project icon" }) },
  { emoji: "🎮", label: msg("Game", { $context: "emoji name, project icon" }) },
  { emoji: "🎵", label: msg("Music", { $context: "emoji name, project icon" }) },
  { emoji: "🎬", label: msg("Movie", { $context: "emoji name, project icon" }) },
  { emoji: "🖼️", label: msg("Picture", { $context: "emoji name, project icon" }) },
  { emoji: "🛍️", label: msg("Shopping", { $context: "emoji name, project icon" }) },
  { emoji: "🔥", label: msg("Fire", { $context: "emoji name, project icon" }) },
  { emoji: "💡", label: msg("Idea", { $context: "emoji name, project icon" }) },
  { emoji: "🧩", label: msg("Puzzle", { $context: "emoji name, project icon" }) },
  { emoji: "📊", label: msg("Chart", { $context: "emoji name, project icon" }) },
  { emoji: "🧠", label: msg("Brain", { $context: "emoji name, project icon" }) },
  { emoji: "🦄", label: msg("Unicorn", { $context: "emoji name, project icon" }) },
  { emoji: "🐙", label: msg("Octopus", { $context: "emoji name, project icon" }) },
  { emoji: "🌱", label: msg("Seedling", { $context: "emoji name, project icon" }) },
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
