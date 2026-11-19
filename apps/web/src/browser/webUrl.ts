export function isWebUrl(url: string): boolean;
export function isWebUrl(url: string) {
  try {
    const { protocol } = new URL(url);
    return (protocol === "http:" || protocol === "https:") satisfies boolean;
  } catch {
    return false satisfies boolean;
  }
}
