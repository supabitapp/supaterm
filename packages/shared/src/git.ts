import {
  repositoryGroupingKeyOf,
  type BranchNamingOptions,
  type RepositoryIdentity,
  type VcsRef,
  type VcsStatusLocalResult,
  type VcsStatusRemoteResult,
  type VcsStatusResult,
  type VcsStatusStreamEvent,
} from "@supaterm/contracts";
import * as Arr from "effect/Array";
import * as Result from "effect/Result";
import { fileBasename } from "./path.ts";

export const WORKTREE_BRANCH_PREFIX = "supaterm";

export function resolveDefaultWorktreeBaseBranch(
  refs: ReadonlyArray<Pick<VcsRef, "name" | "isDefault" | "current" | "isRemote">>,
): string | null {
  return (
    refs.find((ref) => ref.isDefault)?.name ??
    refs.find((ref) => ref.current && !ref.isRemote)?.name ??
    null
  );
}

// Canonical form is `supaterm/<8 hex>`. `supaterm-<8 hex>` is the fallback when a
// plain `supaterm` branch blocks the namespace.
const TEMP_WORKTREE_BRANCH_PATTERN = new RegExp(`^${WORKTREE_BRANCH_PREFIX}[-/][0-9a-f]{8}$`);

export function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");

  const branchFragment = normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  return branchFragment.length > 0 ? branchFragment : "update";
}

/** Names branches after the repository a checkout is grouped under (a fork's own remote), or its folder without a remote. */
export function repositoryBranchPrefix(
  identity: RepositoryIdentity | null,
  workspaceRoot: string,
): string {
  const source = identity ? repositoryGroupingKeyOf(identity) : workspaceRoot;
  const basename = fileBasename(source);
  return basename
    .slice(basename.lastIndexOf(":") + 1)
    .replace(/\.git$/iu, "")
    .toLowerCase();
}

export function formatGeneratedBranchName(raw: string, naming?: BranchNamingOptions): string {
  if (naming?.mode === "custom") return raw.trim();
  const branch = sanitizeBranchFragment(raw);
  if (naming?.mode !== "static") return branch;
  const prefix = naming.prefix
    .split("/")
    .map((part) =>
      part
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join("/");
  return prefix ? `${prefix}/${branch}` : branch;
}

export function sanitizeFeatureBranchName(raw: string): string {
  const sanitized = sanitizeBranchFragment(raw);
  return sanitized.includes("/") ? sanitized : `feature/${sanitized}`;
}

const AUTO_FEATURE_BRANCH_FALLBACK = "feature/update";

export function resolveAutoFeatureBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  const preferred = preferredBranch?.trim();
  const resolvedBase = sanitizeFeatureBranchName(
    preferred && preferred.length > 0 ? preferred : AUTO_FEATURE_BRANCH_FALLBACK,
  );
  return resolveAvailableGitBranchName(existingBranchNames, resolvedBase);
}

export function resolveAvailableGitBranchName(
  existingBranchNames: readonly string[],
  preferredBranch: string,
  firstSuffix = 2,
): string {
  const existingNames = existingBranchNames.map((refName) => refName.toLowerCase());
  const existingRefs = new Set(existingNames);
  const parts = preferredBranch.split("/");
  let resolved = "";

  for (const [index, part] of parts.entries()) {
    const base = resolved ? `${resolved}/${part}` : part;
    let candidate = base;
    let suffix = firstSuffix;
    while (
      existingRefs.has(candidate.toLowerCase()) ||
      (index === parts.length - 1 &&
        existingNames.some((refName) => refName.startsWith(`${candidate.toLowerCase()}/`)))
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    resolved = candidate;
  }

  return resolved;
}

export function deriveLocalBranchNameFromRemoteRef(branchName: string): string {
  const firstSeparatorIndex = branchName.indexOf("/");
  if (firstSeparatorIndex <= 0 || firstSeparatorIndex === branchName.length - 1) {
    return branchName;
  }
  return branchName.slice(firstSeparatorIndex + 1);
}

export function buildTemporaryWorktreeBranchName(
  randomHex: (byteLength: number) => string,
): string {
  const token = randomHex(4)
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 8);
  return `${WORKTREE_BRANCH_PREFIX}/${token}`;
}

/** Flatten temporary supaterm/<hex> refs because an existing supaterm branch blocks nested refs. */
export function flattenTemporaryWorktreeBranchName(refName: string): string {
  const token = refName
    .trim()
    .toLowerCase()
    .slice(WORKTREE_BRANCH_PREFIX.length + 1, WORKTREE_BRANCH_PREFIX.length + 9);
  return `${WORKTREE_BRANCH_PREFIX}-${token}`;
}

export function isTemporaryWorktreeBranch(refName: string): boolean {
  return TEMP_WORKTREE_BRANCH_PATTERN.test(refName.trim().toLowerCase());
}

/**
 * Azure alone addresses one repository under two names that share no part: `ssh.dev.azure.com` and
 * `v3/{org}/{project}/{repo}` over SSH, against `dev.azure.com` and `{org}/{project}/_git/{repo}`
 * everywhere a person sees it. A project cloned over SSH would otherwise be a different repository
 * to every comparison made against a pull request URL, which arrives in the web spelling.
 */
function azureDevOpsRepositoryKey(host: string, segments: ReadonlyArray<string>): string | null {
  if (host !== "ssh.dev.azure.com" && host !== "vs-ssh.visualstudio.com") return null;
  const [marker, organization, project, repository] = segments;
  if (segments.length !== 4 || marker !== "v3") return null;
  if (!organization || !project || !repository) return null;
  return host === "ssh.dev.azure.com"
    ? `dev.azure.com/${organization}/${project}/_git/${repository}`
    : `${organization}.visualstudio.com/${project}/_git/${repository}`;
}

function lowerCaseRemote(value: string): string {
  return value
    .trim()
    .replace(/\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

export function parseGitRemoteRepository(
  value: string,
): { readonly host: string; readonly path: string } | null {
  const normalized = lowerCaseRemote(value);

  if (/^(?:ssh|https?|git):\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      const repositorySegments = url.pathname.split("/").filter((segment) => segment.length > 0);
      if (url.hostname && repositorySegments.length > 1) {
        const host =
          url.protocol === "http:" || url.protocol === "https:" ? url.host : url.hostname;
        return { host, path: repositorySegments.join("/") };
      }
    } catch {
      return null;
    }
  }
  const scpStyleHostAndPath = /^[a-z]:/i.test(normalized)
    ? null
    : /^(?:[a-zA-Z0-9._-]+@)?([^@:/\\\s]+):\/?([^/\s]+(?:\/[^/\s]+)+)$/i.exec(normalized);
  const scpHost = scpStyleHostAndPath?.[1];
  const scpPath = scpStyleHostAndPath?.[2];
  return scpHost && scpPath ? { host: scpHost, path: scpPath } : null;
}

export function normalizeGitRemoteUrl(value: string): string {
  const repository = parseGitRemoteRepository(value);
  if (repository === null) return lowerCaseRemote(value);
  const host = repository.host.replace(/:\d+$/, "");
  return azureDevOpsRepositoryKey(host, repository.path.split("/")) ?? `${host}/${repository.path}`;
}

export type GitRemoteDirection = "fetch" | "push";

export interface GitRemoteVerboseEntry {
  readonly name: string;
  readonly url: string;
  readonly direction: GitRemoteDirection;
}

export interface GitRemoteVerboseUrls {
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export function parseGitRemoteVerboseOutput(output: string): ReadonlyArray<GitRemoteVerboseEntry> {
  const remotes: GitRemoteVerboseEntry[] = [];
  for (const line of output.split("\n")) {
    const match = /^(\S+)\s+(.+?)\s+\((fetch|push)\)(?:\s+.*)?$/u.exec(line.trim());
    if (!match) continue;
    const [, name, url, direction] = match;
    if (!name || !url || !direction) continue;
    remotes.push({
      name,
      url,
      direction: direction === "fetch" ? "fetch" : "push",
    });
  }
  return remotes;
}

export function parseGitRemoteVerboseUrls(
  output: string,
): ReadonlyMap<string, GitRemoteVerboseUrls> {
  const remotes = new Map<string, GitRemoteVerboseUrls>();
  for (const remote of parseGitRemoteVerboseOutput(output)) {
    const current = remotes.get(remote.name) ?? {};
    remotes.set(
      remote.name,
      remote.direction === "fetch"
        ? { ...current, fetchUrl: remote.url }
        : { ...current, pushUrl: remote.url },
    );
  }
  return remotes;
}

export function parseGitRemoteFetchUrls(output: string): ReadonlyMap<string, string> {
  const fetchUrls = new Map<string, string>();
  for (const [name, remote] of parseGitRemoteVerboseUrls(output)) {
    if (remote.fetchUrl) fetchUrls.set(name, remote.fetchUrl);
  }
  return fetchUrls;
}

/** `git config` arguments that list the remotes `gh repo set-default` marked. */
export const GH_RESOLVED_CONFIG_ARGS = [
  "config",
  "--get-regexp",
  "^remote\\..*\\.gh-resolved$",
] as const;

/**
 * Parses `GH_RESOLVED_CONFIG_ARGS` output. A `base` resolution makes that remote's repository the
 * base; any other resolution names the base repository as `owner/name`.
 */
export function parseGhResolvedRemotes(
  output: string,
): ReadonlyArray<{ readonly remoteName: string; readonly resolution: string }> {
  return output.split("\n").flatMap((line) => {
    const match = /^remote\.(.+)\.gh-resolved\s+(\S+)$/u.exec(line.trim());
    return match ? [{ remoteName: match[1]!, resolution: match[2]! }] : [];
  });
}

function parseGitConfigValue(raw: string): string {
  let out = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === "\\" && index + 1 < raw.length) {
      out += raw[index + 1];
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === "#" || char === ";")) break;
    out += char;
  }
  return out.trim();
}

export function isBareGitConfig(configText: string): boolean {
  let inCore = false;
  let bare = false;
  for (const rawLine of configText.split(/\r?\n/)) {
    let line = rawLine.trim();
    // Git accepts the first setting on the section header's own line.
    const header = /^\[\s*([^\]]*?)\s*\](.*)$/.exec(line);
    if (header !== null) {
      inCore = header[1]!.toLowerCase() === "core";
      line = header[2]!.trim();
    }
    if (!inCore) continue;
    const match = /^bare\s*(?:=(.*)|[#;].*)?$/i.exec(line);
    if (match === null) continue;
    const value = match[1] === undefined ? "true" : parseGitConfigValue(match[1]).toLowerCase();
    bare = value === "true" || value === "yes" || value === "on" || value === "1";
  }
  return bare;
}

export function parseOriginUrlFromGitConfig(configText: string): string | null {
  let section: string | null = null;
  let originUrl: string | null = null;
  let firstRemoteUrl: string | null = null;
  const joined = configText.replace(/\\\r?\n[ \t]*/g, "");
  for (const rawLine of joined.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;
    // Git preserves case in quoted remote subsections but lowercases legacy dotted ones.
    const header = /^\[\s*remote(?:\s+"([^"]+)"|\.([^\]\s]+))\s*\](?:\s*[#;].*)?$/i.exec(line);
    if (header) {
      section = header[1] ?? header[2]?.toLowerCase() ?? null;
      continue;
    }
    if (line.startsWith("[")) {
      section = null;
      continue;
    }
    if (section === null) continue;
    const match = /^url\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const url = parseGitConfigValue(match[1] ?? "");
    if (url.length === 0) continue;
    if (section === "origin") {
      originUrl ??= url;
    } else {
      firstRemoteUrl ??= url;
    }
  }
  return originUrl ?? firstRemoteUrl;
}

function deriveLocalBranchNameCandidatesFromRemoteRef(
  branchName: string,
  remoteName?: string,
): ReadonlyArray<string> {
  const candidates = new Set<string>();
  const firstSlashCandidate = deriveLocalBranchNameFromRemoteRef(branchName);
  if (firstSlashCandidate.length > 0) {
    candidates.add(firstSlashCandidate);
  }

  if (remoteName) {
    const remotePrefix = `${remoteName}/`;
    if (branchName.startsWith(remotePrefix) && branchName.length > remotePrefix.length) {
      candidates.add(branchName.slice(remotePrefix.length));
    }
  }

  return [...candidates];
}

// Replace only Git-rejected whitespace; nonbreaking spaces are valid ref characters.
export function sanitizeNewRefName(rawName: string): string {
  return rawName.trim().replace(/[ \t\n\r\f\v]+/g, "-");
}

export function dedupeRemoteBranchesWithLocalMatches(
  refs: ReadonlyArray<VcsRef>,
): ReadonlyArray<VcsRef> {
  const localBranchNames = new Set(
    Arr.filterMap(refs, (refName) =>
      refName.isRemote ? Result.failVoid : Result.succeed(refName.name),
    ),
  );

  return refs.filter((refName) => {
    if (!refName.isRemote) {
      return true;
    }

    if (refName.remoteName !== "origin") {
      return true;
    }

    const localBranchCandidates = deriveLocalBranchNameCandidatesFromRemoteRef(
      refName.name,
      refName.remoteName,
    );
    return !localBranchCandidates.some((candidate) => localBranchNames.has(candidate));
  });
}

const EMPTY_GIT_STATUS_REMOTE: VcsStatusRemoteResult = {
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  aheadOfDefaultCount: 0,
  pr: null,
};

export function mergeGitStatusParts(
  local: VcsStatusLocalResult,
  remote: VcsStatusRemoteResult | null,
): VcsStatusResult {
  return {
    ...local,
    ...(remote ?? EMPTY_GIT_STATUS_REMOTE),
  };
}

function toRemoteStatusPart(status: VcsStatusResult): VcsStatusRemoteResult {
  return {
    hasUpstream: status.hasUpstream,
    aheadCount: status.aheadCount,
    behindCount: status.behindCount,
    ...(status.aheadOfDefaultCount === undefined
      ? {}
      : { aheadOfDefaultCount: status.aheadOfDefaultCount }),
    pr: status.pr,
  };
}

function toLocalStatusPart(status: VcsStatusResult): VcsStatusLocalResult {
  return {
    isRepo: status.isRepo,
    ...(status.sourceControlProvider
      ? { sourceControlProvider: status.sourceControlProvider }
      : {}),
    hasPrimaryRemote: status.hasPrimaryRemote,
    isDefaultRef: status.isDefaultRef,
    refName: status.refName,
    hasWorkingTreeChanges: status.hasWorkingTreeChanges,
    workingTree: status.workingTree,
    ...(status.branchChanges ? { branchChanges: status.branchChanges } : {}),
  };
}

export function applyGitStatusStreamEvent(
  current: VcsStatusResult | null,
  event: VcsStatusStreamEvent,
): VcsStatusResult {
  switch (event._tag) {
    case "snapshot":
      return mergeGitStatusParts(event.local, event.remote);
    case "localUpdated":
      return mergeGitStatusParts(event.local, current ? toRemoteStatusPart(current) : null);
    case "remoteUpdated":
      if (current === null) {
        return mergeGitStatusParts(
          {
            isRepo: true,
            hasPrimaryRemote: false,
            isDefaultRef: false,
            refName: null,
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          },
          event.remote,
        );
      }
      return mergeGitStatusParts(toLocalStatusPart(current), event.remote);
  }
}
