export function isWindowsDrivePath(value: string) {
  return /^[a-zA-Z]:([/\\]|$)/.test(value);
}

export function isUncPath(value: string) {
  return value.startsWith("\\\\");
}

/**
 * Windows treats `/` and `\` alike, so any two leading separators name a UNC
 * or device path. Touching one makes Windows sign in to that host with the
 * user's NTLM credentials, so agent-authored paths must not reach one.
 */
export function isNetworkPath(value: string) {
  return /^[\\/]{2}/.test(value);
}

export function isWindowsAbsolutePath(value: string) {
  return isUncPath(value) || isWindowsDrivePath(value);
}

export function isExplicitRelativePath(value: string) {
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\")
  );
}

function isRootPath(value: string) {
  return value === "/" || value === "\\" || /^[a-zA-Z]:[/\\]$/.test(value);
}

function trimTrailingPathSeparators(value: string) {
  if (value.length === 0 || isRootPath(value)) {
    return value;
  }
  const trimmed = value.startsWith("/")
    ? value.replace(/\/+$/g, "")
    : value.replace(/[\\/]+$/g, "");
  if (trimmed.length === 0) {
    return value;
  }
  return /^[a-zA-Z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
}

export function normalizeProjectPathForDispatch(value: string) {
  return trimTrailingPathSeparators(value.trim());
}

export function normalizeProjectPathForComparison(value: string) {
  const normalized = normalizeProjectPathForDispatch(value);
  if (isWindowsDrivePath(normalized) || isUncPath(normalized)) {
    return normalized.replaceAll("/", "\\").toLowerCase();
  }
  return normalized;
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** Folds accented Latin letters to ASCII ("tìm" -> "tim"); other scripts pass through. */
export function foldLatinDiacritics(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/ß/g, "ss")
    .replace(/ẞ/g, "SS");
}

export function newProjectFolderName(name: string) {
  const slug = foldLatinDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  if (slug.length === 0) return "project";
  return WINDOWS_RESERVED_NAME.test(slug) ? `${slug}-project` : slug;
}

const SLASH_PREFIXED_WINDOWS_DRIVE_PATTERN = /^\/[A-Za-z]:[\\/]/;

export function stripSlashPrefixedWindowsDrive(path: string) {
  return SLASH_PREFIXED_WINDOWS_DRIVE_PATTERN.test(path) ? path.slice(1) : path;
}

export function fileBasename(path: string) {
  const trimmed = path.replace(/[/\\]+$/, "");
  if (trimmed.length === 0) return path;
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : trimmed;
}

export function workspaceRelativeFilePath(path: string, workspaceRoot: string | null | undefined) {
  if (!workspaceRoot) return null;
  const caseInsensitive =
    isWindowsAbsolutePath(stripSlashPrefixedWindowsDrive(workspaceRoot)) ||
    (isNetworkPath(workspaceRoot) && isUncPath(path));
  const normalizedPath = caseInsensitive
    ? stripSlashPrefixedWindowsDrive(path.replaceAll("\\", "/"))
    : path;
  const normalizedRoot = (
    caseInsensitive
      ? stripSlashPrefixedWindowsDrive(workspaceRoot.replaceAll("\\", "/"))
      : workspaceRoot
  ).replace(/\/+$/, "");
  const pathForCompare = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
  const rootForCompare = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  if (pathForCompare.replace(/\/+$/, "") === rootForCompare) return ".";
  if (!pathForCompare.startsWith(`${rootForCompare}/`)) return null;
  const relativePath = normalizedPath.slice(normalizedRoot.length + 1);
  let depth = 0;
  for (const segment of relativePath.split("/")) {
    if (segment === "..") depth -= 1;
    else if (segment.length > 0 && segment !== ".") depth += 1;
    if (depth < 0) return null;
  }
  return relativePath;
}

export function isAbsolutePath(value: string) {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
}

/** Home-relative host paths are expanded by the destination server. */
export function isHostPath(value: string) {
  return isAbsolutePath(value) || value.startsWith("~/");
}

const QUOTED_PATH_AT_END = /(?:'((?:[^']|'\\'')+)'|"([^"]+)")\s*$/;
const SHELL_ESCAPE = /\\([\s'"\\()[\]{}<>|&;$`!*?#~^=])/g;

/**
 * What a folder box holds after a change. A full path pasted into it replaces the box, even after
 * the text already there, because `~/'/a b'` would create that nested folder.
 */
export function resolvePastedPath(previous: string, next: string) {
  const isTyping = next.startsWith(previous)
    ? next.length === previous.length + 1
    : previous.startsWith(next);
  if (isTyping) return next;

  const match = QUOTED_PATH_AT_END.exec(next);
  if (match && previous.startsWith(next.slice(0, match.index).trimEnd())) {
    const quoted = match[1]?.replaceAll("'\\''", "'") ?? match[2] ?? "";
    if (isHostPath(quoted)) return quoted;
  }

  const afterFolder = /[/\\]$/.test(previous) && next.startsWith(previous);
  const path = afterFolder ? next.slice(previous.length) : next;
  if (!isHostPath(path)) return next;
  return isWindowsAbsolutePath(path) ? path : path.replace(SHELL_ESCAPE, "$1");
}

export function resolveWorkspaceFilePath(path: string, workspaceRoot: string) {
  if (isAbsolutePath(path) || path.startsWith("~/") || path.startsWith("~\\")) return path;
  const base = workspaceRoot.replace(/[/\\]+$/, "");
  return isWindowsAbsolutePath(workspaceRoot)
    ? `${base}\\${path.replaceAll("/", "\\")}`
    : `${base}/${path}`;
}
