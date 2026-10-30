import type { ProviderOptionDescriptor } from "@supaterm/contracts";
type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

// Ultracode changes the workflow, not only intensity, so it keeps its name like Ultrathink.
// Max is named too, so the full scale stops short of it.
const NAMED_LEVELS = new Set(["ultracode", "max"]);
const OFF_LEVELS = new Set(["off", "none"]);

/**
 * Maps a reasoning select to bars: one per ordinary level, filled up to the current one, with an
 * off level as none filled. Max, prompt-injected and workflow levels are named instead of drawn.
 */
export function resolveEffortGlyph(descriptor: SelectDescriptor, current: string | null) {
  const special = new Set([...(descriptor.promptInjectedValues ?? []), ...NAMED_LEVELS]);
  const levels = descriptor.options.filter((option) => !special.has(option.id));
  if (levels.length < 2 || current === null) return null;
  const startsAtOff = OFF_LEVELS.has(levels[0]!.id);
  const count = startsAtOff ? levels.length - 1 : levels.length;
  if (special.has(current)) {
    const label = descriptor.options.find((option) => option.id === current)?.label ?? current;
    return { count, filled: count, special: label, label };
  }
  const index = levels.findIndex((option) => option.id === current);
  if (index < 0) return null;
  return {
    count,
    filled: startsAtOff ? index : index + 1,
    special: null,
    label: levels[index]!.label,
  };
}
