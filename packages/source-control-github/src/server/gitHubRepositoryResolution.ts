import {
  GH_RESOLVED_CONFIG_ARGS,
  normalizeGitRemoteUrl,
  parseGhResolvedRemotes,
  parseGitRemoteFetchUrls,
} from "@supaterm/shared/git";
import {
  detectSourceControlProviderFromRemoteUrl,
  isSshRemoteUrl,
} from "@supaterm/shared/sourceControl";
import type * as SourceControlHost from "@supaterm/source-control-core/server/SourceControlHost";
import * as Effect from "effect/Effect";

export interface GitHubRepositoryLocator {
  readonly host: string;
  readonly owner: string;
  readonly name: string;
}

export function parseFetchRemotes(
  remotes: string,
): ReadonlyArray<{ readonly name: string; readonly url: string }> {
  return [...parseGitRemoteFetchUrls(remotes)].map(([name, url]) => ({ name, url }));
}

export function selectGitHubBaseRepository(input: {
  readonly remotes: string;
  readonly resolved: string;
  readonly host: string;
}): { readonly owner: string; readonly name: string } | null {
  const host = input.host.toLowerCase();
  const remotes = parseFetchRemotes(input.remotes);
  const repositories = new Map<string, { readonly owner: string; readonly name: string }>();
  for (const remote of remotes) {
    const [remoteHost, owner, name, ...rest] = normalizeGitRemoteUrl(remote.url).split("/");
    if (remoteHost === host && owner && name && rest.length === 0)
      repositories.set(remote.name, { owner, name });
  }
  const remoteNames = new Set(remotes.map((remote) => remote.name));
  const marks = parseGhResolvedRemotes(input.resolved).filter((mark) =>
    remoteNames.has(mark.remoteName),
  );
  if (marks.length > 1) return null;
  const [mark] = marks;
  if (mark) {
    const repository = repositories.get(mark.remoteName);
    if (repository === undefined || mark.resolution === "base") return repository ?? null;
    const [owner, name, ...rest] = mark.resolution.toLowerCase().split("/");
    return owner && name && rest.length === 0 ? { owner, name } : null;
  }
  if (repositories.size < remotes.length) return null;

  const score = (remoteName: string) =>
    ["origin", "github", "upstream"].indexOf(remoteName.toLowerCase()) + 1;
  const ranked = [...repositories.entries()].toSorted(
    ([left], [right]) => score(right) - score(left),
  );
  const [top, next] = ranked;
  return top !== undefined && (next === undefined || score(top[0]) > score(next[0]))
    ? top[1]
    : null;
}

export function resolveGitHubRepository(input: {
  readonly remotes: string;
  readonly resolved: string;

  readonly hostHint: string | undefined;
  readonly defaultHost: string;
}): { readonly host: string; readonly locator: GitHubRepositoryLocator | null } {
  const fetchRemotes = parseFetchRemotes(input.remotes).map((remote) => ({
    ...remote,
    host: gitHubApiHostForRemote(remote.url),
  }));
  const host =
    (input.hostHint === undefined ? undefined : apiHostForHint(input.hostHint)) ??
    fetchRemotes.find((remote) => remote.name === "origin" && remote.host !== null)?.host ??
    fetchRemotes.find((remote) => remote.host !== null)?.host ??
    input.defaultHost;
  const selected = selectGitHubBaseRepository({
    remotes: input.remotes,
    resolved: input.resolved,
    host,
  });
  if (selected !== null) return { host, locator: { host, ...selected } };

  const rank = (name: string) => ["upstream", "github", "origin"].indexOf(name.toLowerCase());
  const candidates = fetchRemotes
    .filter(
      (remote) => remote.host === host || normalizeGitRemoteUrl(remote.url).split("/")[0] === host,
    )
    .toSorted((left, right) => {
      const l = rank(left.name);
      const r = rank(right.name);
      return (l === -1 ? 99 : l) - (r === -1 ? 99 : r);
    });
  for (const remote of candidates) {
    const [owner, name, ...rest] = normalizeGitRemoteUrl(remote.url).split("/").slice(1);
    if (owner && name && rest.length === 0) return { host, locator: { host, owner, name } };
  }
  return { host, locator: null };
}

/**
 * The repository `gh` picks in a checkout: its `gh repo set-default` mark, else gh's own ranking
 * of the remotes. Unreadable git answers resolve as a checkout without remotes.
 */
export const readCheckoutGitHubRepository = (input: {
  readonly process: SourceControlHost.SourceControlHost["Service"]["process"];
  readonly operation: string;
  readonly cwd: string;
  readonly hostHint: string | undefined;
  readonly defaultHost: string;
}) => {
  const gitRead = (args: ReadonlyArray<string>) =>
    input.process.run({
      operation: input.operation,
      command: "git",
      args,
      cwd: input.cwd,
      allowNonZeroExit: true,
      timeoutMs: 5_000,
    });
  return Effect.all([gitRead(["remote", "-v"]), gitRead(GH_RESOLVED_CONFIG_ARGS)]).pipe(
    Effect.orElseSucceed(() => [null, null] as const),
    Effect.map(([remotes, resolved]) =>
      resolveGitHubRepository({
        remotes: remotes?.exitCode === 0 ? remotes.stdout : "",
        resolved: resolved?.exitCode === 0 ? resolved.stdout : "",
        hostHint: input.hostHint,
        defaultHost: input.defaultHost,
      }),
    ),
  );
};

export function parseGitHubRepositorySelector(
  selector: string,
  defaultHost: string,
): GitHubRepositoryLocator | null {
  const trimmed = selector.trim().replace(/\.git$/i, "");
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const [owner, name, ...rest] = url.pathname.split("/").filter(Boolean);
      return owner && name && rest.length === 0
        ? { host: url.host.toLowerCase(), owner, name }
        : null;
    } catch {
      return null;
    }
  }
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 2) return { host: defaultHost, owner: parts[0]!, name: parts[1]! };
  if (parts.length === 3)
    return { host: parts[0]!.toLowerCase(), owner: parts[1]!, name: parts[2]! };
  return null;
}

export function parsePullRequestReference(
  reference: string,
):
  | { readonly kind: "number"; readonly number: number }
  | { readonly kind: "url"; readonly locator: GitHubRepositoryLocator; readonly number: number }
  | { readonly kind: "branch"; readonly headSelector: string } {
  const trimmed = reference.trim();
  const numbered = /^#?([1-9]\d*)$/.exec(trimmed);
  if (numbered) return { kind: "number", number: Number(numbered[1]) };
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)(?:\/.*)?$/.exec(url.pathname);
      if (match) {
        return {
          kind: "url",
          locator: { host: url.host.toLowerCase(), owner: match[1]!, name: match[2]! },
          number: Number(match[3]),
        };
      }
    } catch {}
  }
  return { kind: "branch", headSelector: trimmed };
}

export function gitHubApiHostForRemote(remoteUrl: string): string | null {
  const provider = detectSourceControlProviderFromRemoteUrl(remoteUrl);
  if (provider === null) return null;
  const host = new URL(provider.baseUrl).host.toLowerCase();

  if (isSshRemoteUrl(remoteUrl) && !host.includes(".")) {
    return host.includes("github") ? "github.com" : null;
  }
  return provider.kind === "github" ? host : null;
}

function apiHostForHint(host: string): string {
  const normalized = host.toLowerCase();
  return !normalized.includes(".") && normalized.includes("github") ? "github.com" : normalized;
}
