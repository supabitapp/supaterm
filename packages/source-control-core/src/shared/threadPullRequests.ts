import type {
  OrchestrationV2AppThread,
  ThreadLinkedPullRequest,
  ThreadPullRequestKey,
  ThreadPullRequestLink,
} from "@supaterm/contracts";
import { canonicalRepositoryPath } from "@supaterm/shared/git";
import { visibleThreadPullRequests } from "@supaterm/shared/threadPullRequests";

import type { SourceControlDefinitionRegistry } from "./definition.ts";

type ThreadPullRequestKeySource = ThreadPullRequestKey & {
  readonly authority?: string;
  readonly url?: string;
};

function isOpen(link: ThreadPullRequestLink) {
  return link.snapshot === null || link.snapshot.state === "open";
}

function latestUpdatedAt(link: ThreadPullRequestLink) {
  const value = link.snapshot?.updatedAt ?? link.linkedAt;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

export type ThreadCurrentPullRequest =
  | { readonly kind: "single"; readonly link: ThreadPullRequestLink }
  | {
      readonly kind: "stack";
      readonly open: ReadonlyArray<ThreadPullRequestLink>;
      readonly top: ThreadPullRequestLink;
    };

function layersFromTop(chain: ThreadPullRequestChain) {
  return chain.layers
    .map((link, index) => ({ link, index, depth: chain.depths[index]! }))
    .sort((left, right) => right.depth - left.depth || right.index - left.index)
    .map((entry) => entry.link);
}

export interface ThreadPullRequestChain {
  readonly kind: "native" | "derived";
  readonly layers: ReadonlyArray<ThreadPullRequestLink>;
  /** One per layer: 0 for the base, parent's depth + 1 above it. Siblings share a depth. */
  readonly depths: ReadonlyArray<number>;
}

export type ThreadPullRequestBadge = {
  readonly state: "open" | "closed" | "merged" | "draft";
} & (
  | {
      readonly kind: "stack";
      readonly layers: number;
    }
  | { readonly kind: "pull-request"; readonly others: number }
);

/**
 * Thread pull request identity reads a link's URL through the hosts in `registry`, so each side
 * binds these once to its own registry.
 */
export function makeThreadPullRequests(
  registry: Pick<
    SourceControlDefinitionRegistry,
    "parseChangeRequestUrl" | "canonicalRepositoryKey" | "findByRepositoryKey"
  >,
) {
  const parse = (url: string) => registry.parseChangeRequestUrl(url)?.link ?? null;

  function normalizeThreadPullRequestKey(key: ThreadPullRequestKeySource) {
    const parsed = key.url === undefined ? null : parse(key.url);
    const authority =
      key.authority ??
      (parsed?.repository === canonicalRepositoryPath(key.repository.trim()) &&
      parsed.number === key.number
        ? parsed.authority
        : undefined);
    const canonical = registry.canonicalRepositoryKey(
      `${(authority ?? key.host).trim().toLowerCase()}/${key.repository.trim().toLowerCase()}`,
    );
    const separator = canonical.indexOf("/");
    return {
      host: canonical.slice(0, separator),
      repository: canonical.slice(separator + 1),
      number: key.number,
    };
  }

  function legacyThreadPullRequestKey(
    linked: Pick<ThreadLinkedPullRequest, "repository" | "number" | "url">,
    fallbackHost?: string,
  ) {
    const parsed = parse(linked.url);
    if (parsed !== null && parsed.number === linked.number) {
      if (
        parsed.authority !== undefined ||
        registry.findByRepositoryKey(`${parsed.host}/${parsed.repository}`) !== undefined
      ) {
        return normalizeThreadPullRequestKey(parsed);
      }
    }
    let host = fallbackHost;
    if (host === undefined) {
      try {
        host = new URL(linked.url).hostname;
      } catch {
        host = "unknown";
      }
    }
    return {
      host: host.trim().toLowerCase() || "unknown",
      repository: linked.repository.trim().toLowerCase(),
      number: linked.number,
    };
  }

  function threadPullRequestKeysEqual(
    left: ThreadPullRequestKeySource,
    right: ThreadPullRequestKeySource,
  ) {
    return threadPullRequestKeyOf(left) === threadPullRequestKeyOf(right);
  }

  const normalizedKeys = new WeakMap<ThreadPullRequestKeySource, ThreadPullRequestKey>();

  function normalizedKeyOf(key: ThreadPullRequestKeySource) {
    let normalized = normalizedKeys.get(key);
    if (normalized === undefined) {
      normalized = normalizeThreadPullRequestKey(key);
      normalizedKeys.set(key, normalized);
    }
    return normalized;
  }

  function threadPullRequestKeyOf(key: ThreadPullRequestKeySource) {
    const normalized = normalizedKeyOf(key);
    return `${normalized.host}/${normalized.repository}#${normalized.number}`;
  }

  function resolveThreadCurrentPullRequest(links: ReadonlyArray<ThreadPullRequestLink>) {
    const visible = visibleThreadPullRequests(links);
    if (visible.length === 0) return null satisfies ThreadCurrentPullRequest | null;
    const open = visible.filter(isOpen);
    if (open.length === 1)
      return { kind: "single", link: open[0]! } satisfies ThreadCurrentPullRequest | null;
    const chains = resolveThreadPullRequestChains(visible);
    if (open.length > 1) {
      const openChains = chains
        .map((chain) => layersFromTop(chain).filter(isOpen))
        .filter((layers) => layers.length > 0);
      const ordered =
        openChains.length === 1
          ? openChains[0]!
          : openChains
              .map((layers) => ({
                layers,
                newestLinkedAt: Math.max(...layers.map((link) => Date.parse(link.linkedAt))),
              }))
              .sort((left, right) => right.newestLinkedAt - left.newestLinkedAt)
              .flatMap((chain) => chain.layers);
      return {
        kind: "stack",
        open: ordered,
        top: ordered[0]!,
      } satisfies ThreadCurrentPullRequest | null;
    }
    if (chains.length === 1) {
      return {
        kind: "single",
        link: layersFromTop(chains[0]!)[0]!,
      } satisfies ThreadCurrentPullRequest | null;
    }
    let latest = visible[0]!;
    let latestTimestamp = latestUpdatedAt(latest);
    for (let index = 1; index < visible.length; index++) {
      const link = visible[index]!;
      const timestamp = latestUpdatedAt(link);
      if (timestamp > latestTimestamp) {
        latest = link;
        latestTimestamp = timestamp;
      }
    }
    return { kind: "single", link: latest } satisfies ThreadCurrentPullRequest | null;
  }

  function resolveThreadCurrentPullRequestLink(links: ReadonlyArray<ThreadPullRequestLink>) {
    const current = resolveThreadCurrentPullRequest(links);
    if (current === null) return null satisfies ThreadPullRequestLink | null;
    return (
      current.kind === "single" ? current.link : current.top
    ) satisfies ThreadPullRequestLink | null;
  }

  function resolveThreadPullRequestChains(links: ReadonlyArray<ThreadPullRequestLink>) {
    const visible = visibleThreadPullRequests(links);
    const chains: Array<ThreadPullRequestChain> = [];
    const placed = new Set<string>();

    const nativeStacks = new Map<string, Array<ThreadPullRequestLink>>();
    for (const link of visible) {
      if (link.stack === null) continue;
      const key = normalizedKeyOf(link);
      const stackKey = `${key.host}/${key.repository}#stack:${link.stack.id}`;
      const members = nativeStacks.get(stackKey) ?? [];
      members.push(link);
      nativeStacks.set(stackKey, members);
    }
    for (const members of nativeStacks.values()) {
      const memberNumbers = new Set(members.map((member) => member.number));
      let layers = members[0]!.stack!.layers;
      let coverage = layers.filter((layer) => memberNumbers.has(layer.number)).length;
      for (const member of members.slice(1)) {
        const candidate = member.stack!.layers;
        const candidateCoverage = candidate.filter((layer) =>
          memberNumbers.has(layer.number),
        ).length;
        if (
          candidateCoverage > coverage ||
          (candidateCoverage === coverage && candidate.length > layers.length)
        ) {
          layers = candidate;
          coverage = candidateCoverage;
        }
      }
      const order = new Map(layers.map((layer, index) => [layer.number, index]));
      members.sort(
        (left, right) =>
          (order.get(left.number) ?? layers.length) - (order.get(right.number) ?? layers.length),
      );
      for (const member of members) placed.add(threadPullRequestKeyOf(member));
      chains.push({ kind: "native", layers: members, depths: members.map((_, index) => index) });
    }

    const remaining = visible.filter((link) => !placed.has(threadPullRequestKeyOf(link)));
    const branchKey = (link: ThreadPullRequestLink, branch: string) => {
      const key = normalizedKeyOf(link);
      return `${key.host}/${key.repository}:${branch}`;
    };
    const byHead = new Map<string, ThreadPullRequestLink | null>();
    for (const link of remaining) {
      if (link.snapshot === null) continue;
      const key = branchKey(link, link.snapshot.headBranch);
      byHead.set(key, byHead.has(key) ? null : link);
    }
    const parentOf = (link: ThreadPullRequestLink) => {
      if (link.snapshot === null) return undefined;
      const parent = byHead.get(branchKey(link, link.snapshot.baseBranch));
      return parent == null || parent === link ? undefined : parent;
    };
    const children = new Map<string, Array<ThreadPullRequestLink>>();
    for (const link of remaining) {
      const parent = parentOf(link);
      if (parent === undefined) continue;
      const key = threadPullRequestKeyOf(parent);
      const siblings = children.get(key) ?? [];
      siblings.push(link);
      children.set(key, siblings);
    }
    for (const base of remaining) {
      if (parentOf(base) !== undefined) continue;
      const layers: Array<ThreadPullRequestLink> = [];
      const depths: Array<number> = [];
      const pending: Array<{ readonly link: ThreadPullRequestLink; readonly depth: number }> = [
        { link: base, depth: 0 },
      ];
      for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        const key = threadPullRequestKeyOf(next.link);
        if (placed.has(key)) continue;
        placed.add(key);
        layers.push(next.link);
        depths.push(next.depth);
        const below = children.get(key) ?? [];
        for (let index = below.length - 1; index >= 0; index -= 1) {
          pending.push({ link: below[index]!, depth: next.depth + 1 });
        }
      }
      if (layers.length > 0) chains.push({ kind: "derived", layers, depths });
    }
    for (const link of remaining) {
      if (!placed.has(threadPullRequestKeyOf(link))) {
        chains.push({ kind: "derived", layers: [link], depths: [0] });
      }
    }
    return chains;
  }

  function resolveThreadPullRequestBadge(
    pullRequests: ReadonlyArray<ThreadPullRequestLink> | undefined,
  ) {
    const visible = visibleThreadPullRequests(pullRequests ?? []);
    if (visible.length === 0) return null satisfies ThreadPullRequestBadge | null;
    const states = visible.map((link) => link.snapshot?.state ?? "open");
    const state = visible.every((link) => link.snapshot?.state === "open" && link.snapshot.isDraft)
      ? "draft"
      : states.includes("open")
        ? "open"
        : states.every((entry) => entry === "merged")
          ? "merged"
          : "closed";
    const chains = resolveThreadPullRequestChains(visible);
    if (visible.length > 1 && chains.length === 1) {
      return {
        kind: "stack",
        layers: visible.length,
        state,
      } satisfies ThreadPullRequestBadge | null;
    }
    return {
      kind: "pull-request",
      others: visible.length - 1,
      state,
    } satisfies ThreadPullRequestBadge | null;
  }

  function threadPullRequestsOf(thread: {
    readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  }) {
    return thread.pullRequests ?? [];
  }

  function applyThreadPullRequestLinkUpdate(
    thread: OrchestrationV2AppThread,
    updated: ThreadPullRequestLink,
  ) {
    return {
      ...thread,
      pullRequests: threadPullRequestsOf(thread).map((link) =>
        threadPullRequestKeysEqual(link, updated) ? updated : link,
      ),
    };
  }

  return {
    normalizeThreadPullRequestKey,
    legacyThreadPullRequestKey,
    threadPullRequestKeysEqual,
    threadPullRequestKeyOf,
    resolveThreadCurrentPullRequest,
    resolveThreadCurrentPullRequestLink,
    resolveThreadPullRequestChains,
    resolveThreadPullRequestBadge,
    threadPullRequestsOf,
    applyThreadPullRequestLinkUpdate,
  };
}

export interface PullRequestListLine {
  readonly link: ThreadPullRequestLink;
  readonly depth: number;
  readonly chainKey: string;
  readonly stack: { readonly kind: ThreadPullRequestChain["kind"]; readonly size: number } | null;
}

function chainKeyOf(chain: ThreadPullRequestChain) {
  const bottom = chain.layers[0]!;
  return `${bottom.host}/${bottom.repository}#${bottom.number}`;
}

export function pullRequestListLines(chains: ReadonlyArray<ThreadPullRequestChain>) {
  const ordered = [...chains].sort(
    (left, right) =>
      Math.max(...right.layers.map(latestUpdatedAt)) -
      Math.max(...left.layers.map(latestUpdatedAt)),
  );
  return ordered.flatMap((chain) => {
    const chainKey = chainKeyOf(chain);
    return chain.layers.map((link, index) => ({
      link,
      depth: chain.depths[index]!,
      chainKey,
      stack:
        index === 0 && chain.layers.length > 1
          ? { kind: chain.kind, size: chain.layers.length }
          : null,
    }));
  });
}
