export function parseUrl(value: string, base?: string) {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}
