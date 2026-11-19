import {
  isNetworkPath,
  isWindowsAbsolutePath,
  stripSlashPrefixedWindowsDrive,
  workspaceRelativeFilePath,
} from "@supaterm/shared/path";

import {
  normalizeMarkdownLinkDestination,
  safeDecodeURIComponent,
  splitMarkdownLinkSearchAndHash,
} from "@supaterm/shared/markdownLinks";
import { parseFileUrlHref } from "@supaterm/shared/fileLinks";

const DIRECT_IMAGE_SOURCE_PATTERN = /^(?:https?:|data:|blob:|\/\/)/i;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export type MarkdownImageSource =
  | { readonly _tag: "Direct"; readonly uri: string }
  | { readonly _tag: "WorkspaceFile"; readonly path: string; readonly relative?: true }
  | { readonly _tag: "Blocked" };

export function markdownImageSourceFragment(source: string): string;
export function markdownImageSourceFragment(source: string) {
  return splitMarkdownLinkSearchAndHash(normalizeMarkdownLinkDestination(source))
    .hash satisfies string;
}

function joinWorkspacePath(workspaceRoot: string, relativePath: string) {
  const separator = isWindowsAbsolutePath(workspaceRoot) ? "\\" : "/";
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  const path = relativePath.replace(/[\\/]/g, separator).replace(/^[\\/]+/, "");
  return `${root}${separator}${path}`;
}

function hostFileSource(path: string, projectRoot: string | null | undefined) {
  return (
    isNetworkPath(path) && workspaceRelativeFilePath(path, projectRoot) === null
      ? { _tag: "Blocked" }
      : { _tag: "WorkspaceFile", path }
  ) satisfies MarkdownImageSource;
}

/**
 * Filesystem paths belong to the environment host and must never reach a
 * browser or native image component without first becoming a signed asset URL.
 */
export function classifyMarkdownImageSource(
  value: string | null | undefined,
  workspaceRoot?: string | null,
  projectRoot?: string | null | undefined,
): MarkdownImageSource;
export function classifyMarkdownImageSource(
  value: string | null | undefined,
  workspaceRoot?: string | null,
  projectRoot: string | null | undefined = workspaceRoot,
) {
  if (value === null || value === undefined)
    return { _tag: "Blocked" } satisfies MarkdownImageSource;

  const source = normalizeMarkdownLinkDestination(value);
  if (source.length === 0 || source.startsWith("#") || source.startsWith("?")) {
    return { _tag: "Blocked" } satisfies MarkdownImageSource;
  }
  if (DIRECT_IMAGE_SOURCE_PATTERN.test(source)) {
    return { _tag: "Direct", uri: source } satisfies MarkdownImageSource;
  }

  if (/^file:/i.test(source)) {
    const target = parseFileUrlHref(source);
    return (
      target === null
        ? { _tag: "Blocked" }
        : hostFileSource(
            stripSlashPrefixedWindowsDrive(safeDecodeURIComponent(target.path)),
            projectRoot,
          )
    ) satisfies MarkdownImageSource;
  }

  const path = stripSlashPrefixedWindowsDrive(
    safeDecodeURIComponent(splitMarkdownLinkSearchAndHash(source).path),
  );
  if (path.length === 0) return { _tag: "Blocked" } satisfies MarkdownImageSource;
  if (path.startsWith("/") || isWindowsAbsolutePath(path)) {
    return hostFileSource(path, projectRoot) satisfies MarkdownImageSource;
  }
  if (URI_SCHEME_PATTERN.test(path) || path.startsWith("~/") || path.startsWith("~\\")) {
    return { _tag: "Blocked" } satisfies MarkdownImageSource;
  }
  if (!workspaceRoot) return { _tag: "Blocked" } satisfies MarkdownImageSource;

  return {
    _tag: "WorkspaceFile",
    path: joinWorkspacePath(workspaceRoot, path),
    relative: true,
  } satisfies MarkdownImageSource;
}
