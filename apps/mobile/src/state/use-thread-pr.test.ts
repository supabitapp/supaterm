import { ProjectId, type ThreadPullRequestLink } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { presentThreadLinkedPullRequests, resolveThreadPrSource } from "./thread-pr-presentation";

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
