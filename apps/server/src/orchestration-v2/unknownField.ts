export function field(source: unknown, key: string): unknown;
export function field(source: unknown, key: string) {
  return (
    typeof source === "object" && source !== null ? Reflect.get(source, key) : undefined
  ) satisfies unknown;
}

export function text(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
