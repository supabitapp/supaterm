import * as Predicate from "effect/Predicate";

/**
 * An Icon Composer document drawn as it looks under `appearance`: each
 * `*-specializations` list keeps only that appearance's value, falling back to
 * the unconditional one, so tools that render one appearance render this one.
 */
export function bakeIconAppearance(document: string, appearance: string): string {
  const specialize = (entries: ReadonlyArray<unknown>) => {
    const forAppearance = entries.filter(
      (entry) => Predicate.isObject(entry) && entry.appearance === appearance,
    );
    const chosen =
      forAppearance.length > 0
        ? forAppearance
        : entries.filter((entry) => Predicate.isObject(entry) && entry.appearance === undefined);
    return chosen.map((entry) =>
      Predicate.isObject(entry)
        ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "appearance"))
        : entry,
    );
  };
  const bake = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(bake);
    if (!Predicate.isObject(node)) return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        key.endsWith("-specializations") && Array.isArray(value) ? specialize(value) : bake(value),
      ]),
    );
  };
  const parsed: unknown = JSON.parse(document);
  return `${JSON.stringify(bake(parsed), null, 2)}\n`;
}
