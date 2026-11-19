export type ComposerTriggerKind =
  | "path"
  | "pull-request"
  | "slash-command"
  | "skill"
  | "slash-skill";
export type ComposerSlashCommand = "model" | "plan" | "default" | "side" | "btw" | "clear";

export interface ComposerTrigger {
  kind: ComposerTriggerKind;
  query: string;
  rangeStart: number;
  rangeEnd: number;
}

function composerFileLinkBasename(path: string) {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

function escapeMarkdownLinkLabel(label: string) {
  return label.replace(/[\\[\]*_]/g, "\\$&");
}

function encodeMarkdownLinkDestination(path: string) {
  return encodeURI(path)
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F")
    .replaceAll("\\", "%5C");
}

export function serializeComposerFileLink(path: string) {
  const label = escapeMarkdownLinkLabel(composerFileLinkBasename(path));
  return `[${label}](${encodeMarkdownLinkDestination(path)})`;
}

function clampCursor(text: string, cursor: number) {
  if (!Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

function isWhitespace(char: string) {
  return char === " " || char === "\n" || char === "\t" || char === "\r";
}

function tokenStartForCursor(text: string, cursor: number) {
  let index = cursor - 1;
  while (index >= 0 && !isWhitespace(text[index] ?? "")) {
    index -= 1;
  }
  return index + 1;
}

function tokenEndForCursor(text: string, cursor: number) {
  let index = cursor;
  while (index < text.length && !isWhitespace(text[index] ?? "")) {
    index += 1;
  }
  return index;
}

function isCurrencyAmountQuery(query: string) {
  return /^\.?[0-9][0-9,._]*(?:[kKmMbBtT]|[eE][0-9]+)?[.,;:!?)]*$/.test(query);
}

function detectComposerPullRequestTrigger(token: string, cursor: number) {
  if (/^[@\p{Sc}]/u.test(token)) return null;
  const match = /(?:^|\p{Ps})#([\p{L}\p{N}][\p{L}\p{N}_-]*)?$/u.exec(token);
  if (!match) return null;
  const query = match[1] ?? "";
  return {
    kind: "pull-request" as const,
    query,
    rangeStart: cursor - query.length - 1,
    rangeEnd: cursor,
  };
}

/**
 * Detect an active trigger (@path, #pull-request, $skill, /command at prompt
 * start, /skill elsewhere) at the cursor position.
 */
export function detectComposerTrigger(text: string, cursorInput: number) {
  const cursor = clampCursor(text, cursorInput);
  const tokenStart = tokenStartForCursor(text, cursor);
  const token = text.slice(tokenStart, cursor);
  if (token.startsWith("/")) {
    const word = text.slice(tokenStart, tokenEndForCursor(text, cursor));
    if (/[/\\]/.test(word.slice(1))) return null satisfies ComposerTrigger | null;
    if (Array.from(text.slice(0, tokenStart)).every(isWhitespace)) {
      return {
        kind: "slash-command",
        query: token.slice(1),
        rangeStart: tokenStart,
        rangeEnd: cursor,
      } satisfies ComposerTrigger | null;
    }
    return {
      kind: "slash-skill",
      query: token.slice(1),
      rangeStart: tokenStart,
      rangeEnd: cursor,
    } satisfies ComposerTrigger | null;
  }

  const pullRequestTrigger = detectComposerPullRequestTrigger(token, cursor);
  if (pullRequestTrigger) return pullRequestTrigger satisfies ComposerTrigger | null;
  const skillPrefix = /^\p{Sc}/u.exec(token);
  if (skillPrefix) {
    if (isCurrencyAmountQuery(token.slice(skillPrefix[0].length)))
      return null satisfies ComposerTrigger | null;
    return {
      kind: "skill",
      query: token.slice(skillPrefix[0].length),
      rangeStart: tokenStart,
      rangeEnd: cursor,
    } satisfies ComposerTrigger | null;
  }
  if (!token.startsWith("@")) {
    return null satisfies ComposerTrigger | null;
  }

  return {
    kind: "path",
    query: token.slice(1),
    rangeStart: tokenStart,
    rangeEnd: cursor,
  } satisfies ComposerTrigger | null;
}

/**
 * A replacement ending in a space swallows one space already after the range, so inserting
 * `@file ` before existing text does not leave a double space.
 */
export function extendReplacementRangeForTrailingSpace(
  text: string,
  rangeEnd: number,
  replacement: string,
) {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
}

/** `/side [prompt]`, or its alias `/btw [prompt]`, as the whole message. */
export function parseSideChatCommand(text: string) {
  const match = /^\/(?:side|btw)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return match ? { prompt: match[1]?.trim() ?? "" } : null;
}

export function replaceTextRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
) {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart));
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd));
  const nextText = `${text.slice(0, safeStart)}${replacement}${text.slice(safeEnd)}`;
  return { text: nextText, cursor: safeStart + replacement.length };
}

/** `/clear` as the whole message arms a fresh session instead of sending. */
export function isClearComposerCommand(text: string) {
  return /^\/clear\s*$/i.test(text.trim());
}
