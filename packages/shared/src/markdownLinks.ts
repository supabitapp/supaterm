import {
  isNetworkPath,
  isWindowsAbsolutePath,
  stripSlashPrefixedWindowsDrive,
  workspaceRelativeFilePath,
} from "./path.ts";
import {
  formatFilePathPosition,
  parseFileUrlHref,
  resolvePathLinkTarget,
  splitFilePathPosition,
} from "./fileLinks.ts";

const RELATIVE_PATH_PREFIX_PATTERN = /^(~\/|\.{1,2}\/)/;

const RELATIVE_FILE_PATH_PATTERN =
  /^(?:[\p{L}\p{M}\p{N}._$+@()[\]-]+(?: +[\p{L}\p{M}\p{N}._$+@()[\]-]+)*\/)+(?:[\p{L}\p{M}\p{N}._$+@()[\]-]+(?: +[\p{L}\p{M}\p{N}._$+@()[\]-]+)*(?::\d+(?::\d+|-\d+)?)?)?$/u;

const RELATIVE_FILE_NAME_PATTERN =
  /^[\p{L}\p{M}\p{N}._$+()[\]-]+(?: +[\p{L}\p{M}\p{N}._$+()[\]-]+)*\.[\p{L}\p{M}\p{N}_-]+(?::\d+(?::\d+|-\d+)?)?$/u;

const EXTERNAL_SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/;

const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+|-\d+)?$/;

const POSITION_ONLY_PATTERN = /^\d+(?::\d+|-\d+)?$/;

const INLINE_CODE_WHITESPACE_PATTERN = /\s/;

const SPACED_ABSOLUTE_PATH_ROOT_PATTERN = /^(?:\/|~\/|[A-Za-z]:[\\/])/;
const SPACED_PATH_BODY_PATTERN =
  /^(?:[\p{L}\p{M}\p{N}._$+@()[\]-]+(?: (?!-+\p{L})[\p{L}\p{M}\p{N}._$+@()[\]-]+)*(?:[\\/]|$))+$/u;

function isSpacedAbsoluteFilePath(text: string) {
  const root = SPACED_ABSOLUTE_PATH_ROOT_PATTERN.exec(text)?.[0];
  if (root === undefined) return false;
  const body = text.slice(root.length).replace(POSITION_SUFFIX_PATTERN, "");
  if (!SPACED_PATH_BODY_PATTERN.test(body)) return false;
  const firstSpace = body.indexOf(" ");
  const foldersBeforeSpace = body.slice(0, firstSpace).split(PATH_SEPARATOR_PATTERN).slice(0, -1);
  if (foldersBeforeSpace.some((folder) => folder === "bin" || folder === "sbin")) return false;
  const spaceInFolder = PATH_SEPARATOR_PATTERN.test(body.slice(firstSpace));
  if (!spaceInFolder && root === "/" && !/^(?:Users|home)[\\/]/.test(body)) return false;
  if (PATH_SEPARATOR_PATTERN.test(body.at(-1) ?? "")) return true;
  const basename = body.split(PATH_SEPARATOR_PATTERN).at(-1) ?? "";
  return FILE_EXTENSION_PATTERN.test(basename) || EXTENSIONLESS_FILE_NAMES.has(basename);
}

const PATH_SEPARATOR_PATTERN = /[\\/]/;
const ELIDED_PATH_SEGMENT_PATTERN = /(?:^|[\\/])(?:\.{3,}|…)(?:[\\/]|$)/;

const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9_-]+$/;
const ANY_FILE_EXTENSION_PATTERN = /\.[^./\\]+$/;
const VERSION_SUFFIX_PATTERN = /\d\.\d[^.]*$/;
const NUMERIC_DOTTED_PATTERN = /^\d+(?:\.\d+)+$/;

const POSIX_FILE_ROOT_PREFIXES = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/var/",
  "/etc/",
  "/opt/",
  "/mnt/",
  "/Volumes/",
  "/private/",
  "/root/",
  "/usr/",
  "/bin/",
  "/sbin/",
  "/lib/",
  "/lib64/",
  "/srv/",
  "/dev/",
  "/proc/",
  "/sys/",
  "/run/",
  "/boot/",
  "/media/",
  "/workspace/",
  "/workspaces/",
] as const;

export const EXTENSIONLESS_FILE_NAMES: ReadonlySet<string> = new Set([
  "Makefile",
  "makefile",
  "GNUmakefile",
  "Dockerfile",
  "Containerfile",
  "Justfile",
  "justfile",
  "Rakefile",
  "Gemfile",
  "Procfile",
  "Brewfile",
  "Caddyfile",
  "Vagrantfile",
  "Jenkinsfile",
  "Podfile",
  "Fastfile",
  "BUILD",
  "WORKSPACE",
  "LICENSE",
  "LICENCE",
  "COPYING",
  "NOTICE",
  "AUTHORS",
  "CONTRIBUTORS",
  "CHANGELOG",
  "README",
  "CODEOWNERS",
]);

const SINGLE_LABEL_HOSTNAMES = new Set(["localhost"]);

const GENERIC_HOSTNAME_TLDS = new Set([
  "com",
  "net",
  "org",
  "io",
  "dev",
  "app",
  "ai",
  "co",
  "edu",
  "gov",
  "mil",
  "info",
  "biz",
  "xyz",
  "me",
  "tv",
  "gg",
  "chat",
  "cloud",
  "site",
  "online",
  "tech",
  "store",
  "link",
]);

const COUNTRY_HOSTNAME_TLDS = new Set([
  "uk",
  "de",
  "fr",
  "nl",
  "se",
  "no",
  "fi",
  "dk",
  "pl",
  "ch",
  "at",
  "be",
  "es",
  "it",
  "pt",
  "eu",
  "us",
  "ca",
  "au",
  "nz",
  "jp",
  "kr",
  "cn",
  "br",
  "ru",
  "mx",
  "ie",
  "cz",
  "tr",
  "sg",
  "hk",
  "cc",
]);

function looksLikeHostname(segment: string, hasPosition: boolean) {
  if (segment.startsWith(".")) return false;
  const lowered = segment.toLowerCase();
  if (SINGLE_LABEL_HOSTNAMES.has(lowered)) return true;
  if (NUMERIC_DOTTED_PATTERN.test(segment)) return true;
  const labels = lowered.split(".");
  const lastLabel = labels.at(-1);
  if (labels.length < 2 || lastLabel === undefined) return false;
  if (GENERIC_HOSTNAME_TLDS.has(lastLabel)) return true;
  return !hasPosition && COUNTRY_HOSTNAME_TLDS.has(lastLabel);
}

export function inlineCodeFilePathCandidate(codeText: string) {
  const trimmed = codeText.trim();
  if (trimmed.length === 0 || trimmed.includes("`")) return null;
  if (INLINE_CODE_WHITESPACE_PATTERN.test(trimmed) && !isSpacedAbsoluteFilePath(trimmed)) {
    return null;
  }

  const candidate = isWindowsAbsolutePath(trimmed) ? trimmed : trimmed.replaceAll("\\", "/");
  const hasPosition = POSITION_SUFFIX_PATTERN.test(candidate);
  if (!hasPosition && !PATH_SEPARATOR_PATTERN.test(candidate)) return null;
  if (ELIDED_PATH_SEGMENT_PATTERN.test(candidate.replace(POSITION_SUFFIX_PATTERN, ""))) return null;

  const hasExplicitPathShape =
    RELATIVE_PATH_PREFIX_PATTERN.test(candidate) ||
    candidate.startsWith("/") ||
    isWindowsAbsolutePath(candidate);
  if (!hasExplicitPathShape) {
    const withoutPosition = candidate.replace(POSITION_SUFFIX_PATTERN, "");
    if (withoutPosition.endsWith("/")) return null;
    const firstSegment = withoutPosition.split("/")[0] ?? withoutPosition;
    if (looksLikeHostname(firstSegment, hasPosition)) return null;
    const basename =
      withoutPosition
        .replace(/[/\\]+$/, "")
        .split(/[\\/]/)
        .at(-1) ?? "";
    if (VERSION_SUFFIX_PATTERN.test(basename)) return null;
    if (!FILE_EXTENSION_PATTERN.test(basename)) {
      if (!hasPosition) return EXTENSIONLESS_FILE_NAMES.has(basename) ? candidate : null;
      if (
        withoutPosition.includes("/") &&
        !ANY_FILE_EXTENSION_PATTERN.test(basename) &&
        !EXTENSIONLESS_FILE_NAMES.has(basename)
      ) {
        return null;
      }
    }
  }
  return candidate;
}

export function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeMarkdownLinkDestination(value: string): string;
export function normalizeMarkdownLinkDestination(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed
  ) satisfies string;
}

export function splitMarkdownLinkSearchAndHash(value: string) {
  const hashIndex = value.indexOf("#");
  const pathWithSearch = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  const queryIndex = pathWithSearch.indexOf("?");
  return {
    path: queryIndex >= 0 ? pathWithSearch.slice(0, queryIndex) : pathWithSearch,
    hash,
  };
}

export function isMarkdownFileLinkLabel(label: string, href: string) {
  const destination = parseMarkdownFileLink(href);
  if (!destination) return false;
  const normalize = (path: string) =>
    path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const labelPosition = splitFilePathPosition(label.trim());
  if (
    (labelPosition.line !== undefined && labelPosition.line !== destination.line) ||
    (labelPosition.column !== undefined && labelPosition.column !== destination.column) ||
    (labelPosition.endLine !== undefined && labelPosition.endLine !== destination.endLine)
  ) {
    return false;
  }
  let labelPath = normalize(labelPosition.path);
  let destinationPath = normalize(destination.path);
  if (labelPath.length === 0) return true;
  if (isWindowsAbsolutePath(destination.path)) {
    labelPath = labelPath.toLowerCase();
    destinationPath = destinationPath.toLowerCase();
  }
  return destinationPath === labelPath || destinationPath.endsWith(`/${labelPath}`);
}

export function isRelativeFilePath(path: string) {
  return (
    RELATIVE_PATH_PREFIX_PATTERN.test(path) ||
    (!path.startsWith("/") && !isWindowsAbsolutePath(path))
  );
}

function looksLikePosixFilesystemPath(path: string) {
  if (!path.startsWith("/")) return false;
  if (POSIX_FILE_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (POSITION_SUFFIX_PATTERN.test(path)) return true;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return EXTENSIONLESS_FILE_NAMES.has(basename) || FILE_EXTENSION_PATTERN.test(basename);
}

function looksLikeFilePath(path: string, authoredPath: string) {
  if (isWindowsAbsolutePath(path) || RELATIVE_PATH_PREFIX_PATTERN.test(path)) return true;
  if (path.startsWith("/")) return looksLikePosixFilesystemPath(authoredPath);
  if (EXTENSIONLESS_FILE_NAMES.has(path)) return true;
  return RELATIVE_FILE_PATH_PATTERN.test(authoredPath) || RELATIVE_FILE_NAME_PATTERN.test(path);
}

function hasExternalScheme(path: string) {
  if (isWindowsAbsolutePath(path)) return false;
  const match = path.match(EXTERNAL_SCHEME_PATTERN);
  if (!match) return false;
  const rest = match[2] ?? "";
  if (rest.startsWith("//")) return true;
  return !POSITION_ONLY_PATTERN.test(rest);
}

export function parseMarkdownFileLink(href: string) {
  const normalized = normalizeMarkdownLinkDestination(href);
  if (normalized.length === 0 || normalized.startsWith("#") || normalized.startsWith("//")) {
    return null;
  }

  const source =
    (normalized.toLowerCase().startsWith("file:") ? parseFileUrlHref(normalized) : null) ??
    splitMarkdownLinkSearchAndHash(normalized);
  const path = stripSlashPrefixedWindowsDrive(safeDecodeURIComponent(source.path.trim()));
  const hash = safeDecodeURIComponent(source.hash.trim());
  if (path.length === 0 || hasExternalScheme(path)) return null;

  const position = parseFilePathLink(path, hash);
  if (position || /^[\\/]/.test(path) || isWindowsAbsolutePath(path)) return position;
  return path.includes("\\") ? parseFilePathLink(path.replaceAll("\\", "/"), hash) : null;
}

function parseFilePathLink(path: string, hash: string) {
  const position = splitFilePathPosition(path, hash);
  return !ELIDED_PATH_SEGMENT_PATTERN.test(position.path) && looksLikeFilePath(position.path, path)
    ? position
    : null;
}

const FENCED_CODE_SEGMENT_PATTERN = /(```[\s\S]*?(?:```|$))/;

const INLINE_CODE_SPAN_PATTERN = /`([^`\n]+)`/g;

export function extractInlineCodeSpans(text: string) {
  const spans: string[] = [];
  const segments = text.split(FENCED_CODE_SEGMENT_PATTERN);
  for (let index = 0; index < segments.length; index += 2) {
    for (const match of (segments[index] ?? "").matchAll(INLINE_CODE_SPAN_PATTERN)) {
      const span = match[1]?.trim();
      if (span) spans.push(span);
    }
  }
  return spans;
}

function markdownRunEndFinder(markdown: string, delimiter: RegExp) {
  let runStart = -1;
  let runEnd = -1;
  return (start: number) => {
    if (start >= runStart && start <= runEnd) return runEnd;
    delimiter.lastIndex = start;
    runStart = start;
    runEnd = delimiter.exec(markdown)?.index ?? markdown.length;
    return runEnd;
  };
}

function markdownLinkTailScanner(markdown: string) {
  const whitespaceEnd = markdownRunEndFinder(markdown, /\S/g);
  const titleEnd = markdownRunEndFinder(markdown, /["']/g);
  const titleWhitespaceEnd = markdownRunEndFinder(markdown, /\S/g);
  return (start: number) => {
    const end = whitespaceEnd(start);
    if (markdown[end] === ")") return end + 1;
    if (end === start || (markdown[end] !== '"' && markdown[end] !== "'")) return null;
    const quoteEnd = titleEnd(end + 1);
    if (quoteEnd === markdown.length) return null;
    const close = titleWhitespaceEnd(quoteEnd + 1);
    return markdown[close] === ")" ? close + 1 : null;
  };
}

const MAX_BARE_DESTINATION_PAREN_DEPTH = 32;

function bareMarkdownLinkDestinationEnd(markdown: string, start: number) {
  const delimiter = /[\s()\\]/g;
  delimiter.lastIndex = start;
  let depth = 0;
  while (true) {
    const index = delimiter.exec(markdown)?.index ?? markdown.length;
    const char = markdown[index];
    if (char === "\\") {
      if (/[()\\]/.test(markdown[index + 1] ?? "")) delimiter.lastIndex = index + 2;
    } else if (char === "(") {
      if (depth === MAX_BARE_DESTINATION_PAREN_DEPTH) return null;
      depth += 1;
    } else if (char === ")" && depth > 0) {
      depth -= 1;
    } else {
      return depth === 0 ? index : null;
    }
  }
}

function markdownLinkDestinationScanner(markdown: string) {
  const whitespaceEnd = markdownRunEndFinder(markdown, /\S/g);
  const angleEnd = markdownRunEndFinder(markdown, /[>\n]/g);
  const angleTail = markdownLinkTailScanner(markdown);
  const bareTail = markdownLinkTailScanner(markdown);
  return (start: number) => {
    if (markdown[start] !== "(") return null;
    const hrefStart = whitespaceEnd(start + 1);
    if (markdown[hrefStart] === "<") {
      const hrefEnd = angleEnd(hrefStart + 1);
      if (hrefEnd > hrefStart + 1 && markdown[hrefEnd] === ">") {
        const end = angleTail(hrefEnd + 1);
        if (end !== null) return { hrefStart: hrefStart + 1, hrefEnd, end };
      }
    }
    const hrefEnd = bareMarkdownLinkDestinationEnd(markdown, hrefStart);
    if (hrefEnd === null || hrefEnd === hrefStart) return null;
    const end = bareTail(hrefEnd);
    return end === null ? null : { hrefStart, hrefEnd, end };
  };
}

function unescapedLabelEnd(markdown: string, start: number) {
  let end = markdown.indexOf("]", start);
  while (end !== -1) {
    let backslashes = 0;
    while (end - backslashes > start && markdown[end - backslashes - 1] === "\\") backslashes += 1;
    if (backslashes % 2 === 0) return end;
    end = markdown.indexOf("]", end + 1);
  }
  return -1;
}

export function extractMarkdownLinkHrefs(markdown: string) {
  const hrefs: string[] = [];
  const scanDestination = markdownLinkDestinationScanner(markdown);
  let cursor = 0;
  while (cursor < markdown.length) {
    const labelStart = markdown.indexOf("[", cursor);
    if (labelStart === -1) break;
    const labelEnd = unescapedLabelEnd(markdown, labelStart + 1);
    if (labelEnd === -1) break;

    cursor = labelEnd + 1;
    const destination = scanDestination(cursor);
    if (!destination) continue;
    cursor = destination.end;
    const href = markdown.slice(destination.hrefStart, destination.hrefEnd).trim();
    if (href) hrefs.push(href);
  }
  return hrefs;
}

export function resolveMarkdownFileLinkTarget(
  href: string | undefined,
  cwd?: string,
  baseDir: string | undefined = cwd,
) {
  if (!href) return null;
  const target = parseMarkdownFileLink(href);
  if (!target) return null;

  const pathWithPosition = formatFilePathPosition(target);
  if (!isRelativeFilePath(pathWithPosition)) {
    return isNetworkPath(target.path) && workspaceRelativeFilePath(target.path, cwd) === null
      ? null
      : pathWithPosition;
  }
  if (!baseDir) return null;
  return resolvePathLinkTarget(pathWithPosition, baseDir);
}

export function isWindowsDrivePathHref(href: string) {
  return /^[A-Za-z]:[\\/]/.test(safeDecodeURIComponent(href));
}

export function absoluteFilePathMatches(text: string): Array<{ index: number; path: string }>;
export function absoluteFilePathMatches(text: string) {
  const paths: Array<{ index: number; path: string }> = [];
  for (const match of text.matchAll(/(^|[\s(["'])(\/[^\s<>"'`]+)/g)) {
    const source = match[2]!;
    let parentheses = 0;
    let brackets = 0;
    for (const character of source) {
      if (character === "(") parentheses += 1;
      if (character === ")") parentheses -= 1;
      if (character === "[") brackets += 1;
      if (character === "]") brackets -= 1;
    }
    let end = source.length;
    while (end > 0) {
      const character = source[end - 1]!;
      if (character === ")" && parentheses < 0) parentheses += 1;
      else if (character === "]" && brackets < 0) brackets += 1;
      else if (!".,;!?:".includes(character)) break;
      end -= 1;
    }
    const path = source.slice(0, end);
    if (path.endsWith("/") && source.startsWith("...", end)) continue;
    if (
      !POSIX_FILE_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix)) &&
      !POSITION_SUFFIX_PATTERN.test(path)
    )
      continue;
    const basename = path.slice(path.lastIndexOf("/") + 1);
    if (
      !POSITION_SUFFIX_PATTERN.test(path) &&
      !FILE_EXTENSION_PATTERN.test(basename) &&
      !EXTENSIONLESS_FILE_NAMES.has(basename)
    )
      continue;
    if (!parseMarkdownFileLink(path)) continue;
    paths.push({ index: match.index + match[1]!.length, path });
  }
  return paths satisfies Array<{ index: number; path: string }>;
}
