import {
  ProjectId,
  type PullRequestSummary,
  SourceControlProviderKind,
  type ThreadPullRequestLink,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  knownPullRequestSummary,
  presentThreadLinkedPullRequests,
  rememberBounded,
  resolveThreadPrSource,
} from "./thread-pr-presentation";

function linkedPr(
  number: number,
  overrides: Partial<ThreadPullRequestLink> = {},
): ThreadPullRequestLink {
  return {
    host: "github.com",
    repository: "supabitapp/supacode-next",
    number,
    url: `https://github.com/supabitapp/supacode-next/pull/${number}`,
    source: "manual",
    linkedAt: "2026-09-08T00:00:00.000Z",
    stack: null,
    snapshot: {
      state: "open",
      title: `Change ${number}`,
      headBranch: `change-${number}`,
      baseBranch: "main",
      isDraft: false,
      updatedAt: null,
      syncedAt: "2026-09-08T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("presentThreadLinkedPullRequests", () => {
  it("uses the top of a derived stack even when its bottom was linked later", () => {
    const bottom = linkedPr(1, { linkedAt: "2026-09-09T00:00:00.000Z" });
    const top = linkedPr(2);
    expect(
      presentThreadLinkedPullRequests([
        bottom,
        {
          ...top,
          snapshot: { ...top.snapshot!, baseBranch: "change-1" },
        },
      ]),
    ).toMatchObject({ kind: "stack", label: "2", number: 2, url: top.url });
  });

  it("names a single link with its host's term", () => {
    expect(presentThreadLinkedPullRequests([linkedPr(7)])?.accessibilityLabel).toBe(
      "#7 pull request open",
    );
    expect(
      presentThreadLinkedPullRequests([
        linkedPr(7, {
          host: "gitlab.com",
          repository: "supabitapp/supaterm",
          url: "https://gitlab.com/supabitapp/supaterm/-/merge_requests/7",
        }),
      ])?.accessibilityLabel,
    ).toBe("#7 merge request open");
  });
});

describe("resolveThreadPrSource compatibility", () => {
  const branchRef = {
    projectId: ProjectId.make("project"),
    repository: "example/repo",
    number: 2,
    url: "https://github.com/example/repo/pull/2",
  };

  it("uses persisted snapshots without polling", () => {
    expect(
      resolveThreadPrSource({ pullRequests: [linkedPr(3)], branchPullRequest: branchRef }),
    ).toMatchObject({ linkedPresentation: { number: 3 }, pullRequestRef: null });
  });

  it("uses the branch reference when no linked pull requests remain", () => {
    expect(resolveThreadPrSource({ pullRequests: [], branchPullRequest: branchRef })).toEqual({
      linkedPresentation: null,
      pullRequestRef: branchRef,
    });
    expect(resolveThreadPrSource({ pullRequests: [], branchPullRequest: null })).toEqual({
      linkedPresentation: null,
      pullRequestRef: null,
    });
  });

  it("does not poll when a link is waiting for its first snapshot", () => {
    expect(
      resolveThreadPrSource({
        pullRequests: [linkedPr(3, { snapshot: null })],
        branchPullRequest: branchRef,
      }),
    ).toMatchObject({ linkedPresentation: { number: 3, state: null }, pullRequestRef: null });
  });
});

describe("knownPullRequestSummary", () => {
  it("seeds from the newest summary of the same pull request, never another's", () => {
    const projectId = ProjectId.make("project");
    const link = linkedPr(7);
    const threads = [
      {
        projectId,
        pullRequests: [
          { ...link, snapshot: { ...link.snapshot!, updatedAt: "2026-09-08T00:00:00.000Z" } },
        ],
      },
    ];
    const listed: PullRequestSummary = {
      provider: SourceControlProviderKind.make("github"),
      projectId,
      repository: "supabitapp/supacode-next",
      number: 7,
      title: "Listed title",
      url: "https://github.com/supabitapp/supacode-next/pull/7",
      state: "open",
      headBranch: "change-7",
      baseBranch: "main",
      updatedAt: "2026-09-09T00:00:00.000Z",
    };
    const lookup = (host: string, number: number, summaries = [listed]) =>
      knownPullRequestSummary(
        { host, repository: "supabitapp/supacode-next", number },
        threads,
        summaries,
      );

    expect(lookup("github.com", 7, [])?.title).toBe("Change 7");
    expect(lookup("github.com", 7)?.title).toBe("Listed title");
    expect(lookup("github.com", 8)).toBeUndefined();
    expect(lookup("gitlab.com", 7)).toBeUndefined();

    const sameVersion = { ...listed, updatedAt: "2026-09-08T00:00:00.000Z" };
    const syncedAt = Date.parse(link.snapshot!.syncedAt);
    expect(lookup("github.com", 7, [{ ...sameVersion, observedAt: syncedAt - 1 }])?.title).toBe(
      "Change 7",
    );
    expect(lookup("github.com", 7, [{ ...sameVersion, observedAt: syncedAt + 1 }])?.title).toBe(
      "Listed title",
    );
  });
});

describe("rememberBounded", () => {
  it("moves a re-answered entry to the newest slot and evicts the oldest past the limit", () => {
    let snapshots: ReadonlyMap<string, number> = new Map();
    snapshots = rememberBounded(snapshots, "a", 1, 2);
    snapshots = rememberBounded(snapshots, "b", 2, 2);
    snapshots = rememberBounded(snapshots, "a", 3, 2);
    snapshots = rememberBounded(snapshots, "c", 4, 2);
    expect([...snapshots]).toEqual([
      ["a", 3],
      ["c", 4],
    ]);
  });
});
