import type { ProjectIconColor } from "@supaterm/contracts";

// Hue-ordered and limited to hues that stay distinct on a 16px tile; neighbors such as
// purple and fuchsia read as the same color there. The picker still offers every color.
export const AUTOMATIC_PROJECT_COLORS = [
  "red",
  "orange",
  "amber",
  "lime",
  "emerald",
  "cyan",
  "blue",
  "violet",
  "pink",
] as const satisfies ReadonlyArray<ProjectIconColor>;

export function projectColorKey(projectName: string): string {
  return projectName.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function preferredProjectColorIndex(colorKey: string): number {
  let hash = 0x811c9dc5;
  for (const glyph of colorKey) {
    hash = Math.imul(hash ^ (glyph.codePointAt(0) ?? 0), 0x01000193);
  }
  return (hash >>> 0) % AUTOMATIC_PROJECT_COLORS.length;
}

export function preferredProjectColor(colorKey: string): ProjectIconColor {
  return AUTOMATIC_PROJECT_COLORS[preferredProjectColorIndex(colorKey)] ?? "blue";
}
