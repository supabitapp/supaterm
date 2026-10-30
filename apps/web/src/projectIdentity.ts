import type { ProjectIconColor } from "@supaterm/contracts";

export interface ProjectIdentity {
  readonly monogram: string;
  readonly color: ProjectIconColor;
}

// Hue-ordered and limited to hues that stay distinct on a 16px tile; neighbors such as
// purple and fuchsia read as the same color there. The picker still offers every color.
const AUTOMATIC_PROJECT_COLORS = [
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

function normalizeProjectName(projectName: string): string {
  return projectName.normalize("NFKC").trim();
}

export function projectMonogram(projectName: string): string {
  const words = normalizeProjectName(projectName).match(/[\p{L}\p{N}]+/gu) ?? [];
  const firstWord = words[0];
  if (!firstWord) return "PR";

  const glyphs = Array.from(firstWord);
  const first = glyphs[0] ?? "P";
  const second =
    glyphs.slice(1).find((glyph) => /\p{N}/u.test(glyph)) ??
    (words.length > 1 ? Array.from(words.at(-1) ?? "")[0] : glyphs.at(-1)) ??
    first;
  return Array.from(`${first}${second}`.toUpperCase()).slice(0, 2).join("");
}

export function projectColorKey(projectName: string): string {
  return normalizeProjectName(projectName).toLocaleLowerCase("en-US");
}

function preferredColorIndex(colorKey: string): number {
  let hash = 0x811c9dc5;
  for (const glyph of colorKey) {
    hash = Math.imul(hash ^ (glyph.codePointAt(0) ?? 0), 0x01000193);
  }
  return (hash >>> 0) % AUTOMATIC_PROJECT_COLORS.length;
}

export function preferredProjectColor(colorKey: string): ProjectIconColor {
  return AUTOMATIC_PROJECT_COLORS[preferredColorIndex(colorKey)] ?? "blue";
}

function hueDistance(left: number, right: number): number {
  const distance = Math.abs(left - right);
  return Math.min(distance, AUTOMATIC_PROJECT_COLORS.length - distance);
}

function distinctColorIndex(preferred: number, used: ReadonlySet<number>): number {
  if (!used.has(preferred)) return preferred;
  let best = preferred;
  let bestDistance = 0;
  for (let offset = 1; offset < AUTOMATIC_PROJECT_COLORS.length; offset += 1) {
    const candidate = (preferred + offset) % AUTOMATIC_PROJECT_COLORS.length;
    if (used.has(candidate)) continue;
    const distance = Math.min(...Array.from(used, (index) => hueDistance(candidate, index)));
    if (distance > bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Projects claim colors oldest first, so adding a project never recolors an existing one.
 * A project that lost its preferred color to an older one can move when that older
 * project is renamed or removed.
 */
export function assignProjectColors(
  projects: ReadonlyArray<{ readonly title: string; readonly createdAt: string }>,
): ReadonlyMap<string, ProjectIconColor> {
  const colors = new Map<string, ProjectIconColor>();
  let used = new Set<number>();
  const oldestFirst = projects.toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  for (const project of oldestFirst) {
    const colorKey = projectColorKey(project.title);
    if (colors.has(colorKey)) continue;
    if (used.size === AUTOMATIC_PROJECT_COLORS.length) used = new Set();
    const index = distinctColorIndex(preferredColorIndex(colorKey), used);
    used.add(index);
    colors.set(colorKey, AUTOMATIC_PROJECT_COLORS[index] ?? "blue");
  }
  return colors;
}
