export function crashReportingEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
