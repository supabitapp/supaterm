import {
  projectMonogram,
  preferredProjectColor,
  projectColorKey,
} from "@supaterm/shared/projectIdentity";
import type { ProjectIconColor, ProjectIconOverride } from "@supaterm/contracts";
import type { IconNode } from "@supaterm/icons/nodes";
import { resolveProjectIcon } from "@supaterm/icons/project";

export type ProjectIconGlyph =
  | { readonly kind: "emoji"; readonly emoji: string }
  | { readonly kind: "icon"; readonly node: IconNode; readonly color: ProjectIconColor }
  | { readonly kind: "monogram"; readonly text: string; readonly color: ProjectIconColor };

export function countGlyphs(text: string): number {
  return Array.from(text.replace(/\p{M}/gu, "")).length;
}

export function resolveProjectIconGlyph(
  projectIcon: ProjectIconOverride | null | undefined,
): ProjectIconGlyph | null {
  switch (projectIcon?.kind) {
    case "emoji":
      return { kind: "emoji", emoji: projectIcon.emoji };
    case "monogram":
      return { kind: "monogram", text: projectIcon.text, color: projectIcon.color };
    case "icon":
    case "lucide":
      return { kind: "icon", node: resolveProjectIcon(projectIcon).node, color: projectIcon.color };
    case undefined:
      return null;
  }
}

const PROJECT_ICON_COLOR_CLASSES: Record<
  ProjectIconColor,
  { readonly text: string; readonly background: string }
> = {
  gray: { text: "text-gray-500", background: "bg-gray-500/15" },
  red: { text: "text-red-500", background: "bg-red-500/15" },
  orange: { text: "text-orange-500", background: "bg-orange-500/15" },
  amber: { text: "text-amber-500", background: "bg-amber-500/15" },
  yellow: { text: "text-yellow-500", background: "bg-yellow-500/15" },
  lime: { text: "text-lime-500", background: "bg-lime-500/15" },
  green: { text: "text-green-500", background: "bg-green-500/15" },
  emerald: { text: "text-emerald-500", background: "bg-emerald-500/15" },
  teal: { text: "text-teal-500", background: "bg-teal-500/15" },
  cyan: { text: "text-cyan-500", background: "bg-cyan-500/15" },
  sky: { text: "text-sky-500", background: "bg-sky-500/15" },
  blue: { text: "text-blue-500", background: "bg-blue-500/15" },
  indigo: { text: "text-indigo-500", background: "bg-indigo-500/15" },
  violet: { text: "text-violet-500", background: "bg-violet-500/15" },
  purple: { text: "text-purple-500", background: "bg-purple-500/15" },
  fuchsia: { text: "text-fuchsia-500", background: "bg-fuchsia-500/15" },
  pink: { text: "text-pink-500", background: "bg-pink-500/15" },
  rose: { text: "text-rose-500", background: "bg-rose-500/15" },
};

export function projectIconColorClassNames(color: ProjectIconColor) {
  return PROJECT_ICON_COLOR_CLASSES[color];
}

export function projectAutoMonogram(projectTitle: string): ProjectIconGlyph | null {
  return projectTitle.trim()
    ? {
        kind: "monogram",
        text: projectMonogram(projectTitle),
        color: preferredProjectColor(projectColorKey(projectTitle)),
      }
    : null;
}
