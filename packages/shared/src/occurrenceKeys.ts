export function withOccurrenceKeys<T>(
  items: ReadonlyArray<T>,
  identity: (item: T) => string,
): Array<{ readonly item: T; readonly key: string }> {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const id = identity(item);
    const occurrence = occurrences.get(id) ?? 0;
    occurrences.set(id, occurrence + 1);
    return { item, key: `${id}:${occurrence}` };
  });
}
