import { parseUrl } from "@supaterm/shared/url";

import type { WordLink } from "./word-protocol";

const schemes = new Set(["http:", "https:", "mailto:"]);

/** A document's link address, normalized, when the host may open it; undefined otherwise, so the link stays text. */
export function externalUrl(href: string) {
  const url = parseUrl(href);

  return url && schemes.has(url.protocol) ? url.href : undefined;
}

/** Where a Word link leads, if it is one a reader may follow: a bookmark in the document, or an `externalUrl`. */
export function wordLink(href: string | undefined) {
  if (!href) return undefined satisfies WordLink | undefined;

  if (href.startsWith("#"))
    return (href.length > 1 ? { kind: "internal", bookmark: href.slice(1) } : undefined) satisfies
      | WordLink
      | undefined;

  const url = externalUrl(href);

  return (url ? { kind: "external", url } : undefined) satisfies WordLink | undefined;
}
