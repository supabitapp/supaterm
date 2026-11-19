import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const THREAD_LINK_PROTOCOL = "supaterm-thread";
const V1_PREFIX = `${THREAD_LINK_PROTOCOL}://v1/`;
const V2_PREFIX = `${THREAD_LINK_PROTOCOL}://v2/`;
const THREAD_HREF = String.raw`supaterm-thread:\/\/v[12]\/`;
const LABEL = String.raw`[^[\]\n]*`;
const THREAD_LINK_OUTSIDE_CODE = new RegExp(
  [
    String.raw`\\[!-/:-@[-\`{-~]`,
    String.raw`(?<fence>(\`{3,}|~{3,})[\s\S]*?(?:\2|$))`,
    String.raw`(?<span>(\`+)[^\n]*?\4)`,
    String.raw`\[(?<label>${LABEL})\]\((?:<(?<angleHref>${THREAD_HREF}[^\s<>]+)>|(?<href>${THREAD_HREF}[^\s>)]+))\)`,
    String.raw`\[${LABEL}\]\((?:<[^<>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?\)`,
    String.raw`<(?<autolink>${THREAD_HREF}[^\s<>]+)>`,
  ].join("|"),
  "g",
);

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);
const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);

/** A v1 link names no environment; the message's own, or a unique match, stands in. */
export interface ThreadLink {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId;
}

/** The ids as written. Thread ids can hold percent escapes of their own, so they are not decoded. */
export function parseThreadLinkHref(href: string) {
  if (href.startsWith(V1_PREFIX)) {
    const threadId = Option.getOrNull(decodeThreadId(href.slice(V1_PREFIX.length)));
    return threadId === null ? null : { environmentId: null, threadId };
  }
  if (!href.startsWith(V2_PREFIX)) return null;
  const path = href.slice(V2_PREFIX.length);
  const slash = path.indexOf("/");
  if (slash < 0) return null;
  const environmentId = Option.getOrNull(decodeEnvironmentId(path.slice(0, slash)));
  const threadId = Option.getOrNull(decodeThreadId(path.slice(slash + 1)));
  return environmentId === null || threadId === null ? null : { environmentId, threadId };
}

function percentDecodedThreadLinkId(threadId: ThreadId) {
  try {
    const decoded = decodeURIComponent(threadId);
    return decoded === threadId ? null : Option.getOrNull(decodeThreadId(decoded));
  } catch {
    return null;
  }
}

/** The threads a link can name, in its own environment or else the message's: as written, then decoded. */
export function threadLinkCandidates(link: ThreadLink, messageEnvironmentId: EnvironmentId) {
  const environmentId = link.environmentId ?? messageEnvironmentId;
  const decodedId = percentDecodedThreadLinkId(link.threadId);
  const written = { environmentId, threadId: link.threadId };
  return decodedId === null ? [written] : [written, { environmentId, threadId: decodedId }];
}

/** A v1 link its message's environment lacks opens a unique match elsewhere; a v2 link never does. */
export function guessThreadLinkRef(link: ThreadLink, refs: ReadonlyArray<ScopedThreadRef>) {
  if (link.environmentId !== null) return null;
  const decodedId = percentDecodedThreadLinkId(link.threadId);
  for (const threadId of decodedId === null ? [link.threadId] : [link.threadId, decodedId]) {
    let match: ScopedThreadRef | null = null;
    for (const ref of refs) {
      if (ref.threadId !== threadId) continue;
      if (match !== null) return null;
      match = ref;
    }
    if (match !== null) return match;
  }
  return null;
}

function threadLinkHref(link: ThreadLink) {
  return link.environmentId === null
    ? `${V1_PREFIX}${link.threadId}`
    : `${V2_PREFIX}${link.environmentId}/${link.threadId}`;
}

/** Without a label, an autolink: clients show the thread's current title. */
export function formatThreadLink(ref: ThreadLink, label?: string) {
  const cleaned = label
    ?.replace(/[[\]\\\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const href = threadLinkHref(ref);
  const destination = /[()]/.test(href) ? `<${href}>` : href;
  return cleaned ? `[${cleaned}](${destination})` : `<${href}>`;
}

export function hasThreadLinks(markdown: string) {
  return markdown.includes(`${THREAD_LINK_PROTOCOL}://v`);
}

/** Every thread the markdown's links can name, so their titles are keyed reads. */
export function threadLinkRefs(markdown: string, messageEnvironmentId: EnvironmentId) {
  const refs = new Map<string, ScopedThreadRef>();
  const pattern = new RegExp(THREAD_LINK_OUTSIDE_CODE);
  for (let match = pattern.exec(markdown); match !== null; match = pattern.exec(markdown)) {
    const href = match.groups?.angleHref ?? match.groups?.href ?? match.groups?.autolink;
    const link = href === undefined ? null : parseThreadLinkHref(href);
    if (link === null) continue;
    for (const ref of threadLinkCandidates(link, messageEnvironmentId)) {
      refs.set(`${ref.environmentId}/${ref.threadId}`, ref);
    }
  }
  return [...refs.values()];
}

export function unknownThreadLinkLabel(link: ThreadLink, messageEnvironmentId: EnvironmentId) {
  return link.environmentId === null || link.environmentId === messageEnvironmentId
    ? "Thread no longer available"
    : "Thread on another machine";
}

/**
 * Writes each link with its thread's current title. A link `title` cannot resolve becomes plain
 * text, its written label or a neutral one, except a labeled v1 link, which may open elsewhere.
 */
export function relabelThreadLinks(
  markdown: string,
  messageEnvironmentId: EnvironmentId,
  title: (ref: ScopedThreadRef) => string | undefined,
) {
  if (!hasThreadLinks(markdown)) return markdown;
  return markdown.replace(THREAD_LINK_OUTSIDE_CODE, (source, ...args) => {
    const groups = args.at(-1) as {
      angleHref?: string;
      href?: string;
      autolink?: string;
      label?: string;
    };
    const labeledHref = groups.angleHref ?? groups.href;
    const href = labeledHref ?? groups.autolink;
    if (href === undefined) return source;
    const written = parseThreadLinkHref(href);
    if (written === null) return source;
    const environmentId = written.environmentId ?? messageEnvironmentId;
    const decoded = percentDecodedThreadLinkId(written.threadId);
    const threadId =
      title({ environmentId, threadId: written.threadId }) === undefined &&
      decoded !== null &&
      title({ environmentId, threadId: decoded }) !== undefined
        ? decoded
        : written.threadId;
    const current = title({ environmentId, threadId });
    if (current === undefined) {
      if (labeledHref !== undefined && written.environmentId === null) return source;
      return groups.label?.trim() || unknownThreadLinkLabel(written, messageEnvironmentId);
    }
    return formatThreadLink(
      { environmentId: written.environmentId, threadId },
      current.trim() || groups.label || threadId,
    );
  });
}
