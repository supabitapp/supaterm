import type { ComposerInlineToken } from "./composerInlineTokens.ts";
import { composerFileLinkPath } from "./composerTrigger.ts";
import { fileBasename } from "./path.ts";

const MENTION_TOKEN_REGEX = /(^|\s)@(?:"((?:\\.|[^"\\])*)"|([^\s@"]+))(?=\s)/g;
// Bound unmatched-bracket rescans to avoid quadratic work; only basenames survive, and common filesystems cap them at 255.
const MAX_FILE_LINK_LABEL_LENGTH = 512;
const FILE_LINK_TOKEN_REGEX = new RegExp(
  `(^|\\s)\\[((?:\\\\.|[^\\]\\\\]){0,${MAX_FILE_LINK_LABEL_LENGTH}})\\]\\(([^)\\s]+)\\)(?=\\s)`,
  "g",
);
const URI_SCHEME_REGEX = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;
const SCOPED_PACKAGE_REFERENCE_REGEX =
  /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:\/[^\s@"]+)*$/;
const DECORATOR_CALL_REFERENCE_REGEX = /^[\p{ID_Start}_$][\p{ID_Continue}.$\u200c\u200d]*\(/u;

export function collectComposerMentionTokens(text: string): ComposerInlineToken[] {
  const matches: ComposerInlineToken[] = [];

  for (const match of text.matchAll(FILE_LINK_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const label = (match[2] ?? "").replace(/\\(.)/g, "$1");
    const encodedPath = match[3] ?? "";
    let path = encodedPath;
    try {
      path = decodeURIComponent(encodedPath);
    } catch {}
    path = composerFileLinkPath(encodedPath, path);
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const basename = separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
    const hasExternalScheme = URI_SCHEME_REGEX.test(path) && !WINDOWS_DRIVE_PATH_REGEX.test(path);
    if (!path || hasExternalScheme || label !== basename) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "mention",
      value: path,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  for (const match of text.matchAll(MENTION_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const quotedPath = match[2];
    const path = quotedPath !== undefined ? quotedPath.replace(/\\(.)/g, "$1") : (match[3] ?? "");
    if (
      !path ||
      (quotedPath === undefined &&
        (SCOPED_PACKAGE_REFERENCE_REGEX.test(path) || DECORATOR_CALL_REFERENCE_REGEX.test(path)))
    ) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "mention",
      value: path,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  return matches;
}

/** Shows each `@`-file link by its file name, as its composer chip does, for one-line previews. */
export function composerFileLinksToPlainText(text: string): string {
  let result = "";
  let cursor = 0;
  // The composer reads a link as a mention only before whitespace, so one may end the text.
  for (const token of collectComposerMentionTokens(`${text} `)) {
    if (!token.source.startsWith("[")) continue;
    result += text.slice(cursor, token.start) + fileBasename(token.value);
    cursor = token.end;
  }
  return result + text.slice(cursor);
}
