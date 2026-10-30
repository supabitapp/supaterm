import type { WordLink } from "./word-protocol";

const schemes = new Set(["http:", "https:", "mailto:"]);

export function externalUrl(href: string) {
  const url = URL.parse(href);

  return url && schemes.has(url.protocol) ? url.href : undefined;
}

export function wordLink(href: string | undefined): WordLink | undefined {
  if (!href) return undefined;

  if (href.startsWith("#"))
    return href.length > 1 ? { kind: "internal", bookmark: href.slice(1) } : undefined;

  const url = externalUrl(href);

  return url ? { kind: "external", url } : undefined;
}
