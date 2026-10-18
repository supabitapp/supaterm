import { SourceControlProviderKind } from "@supaterm/contracts";
import { ProjectId, type ThreadPullRequestLink, type VcsStatusResult } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  presentThreadLinkedPullRequests,
  presentThreadPr,
  resolveThreadPrBadgeAction,
  resolveThreadPrSource,
} from "./thread-pr-presentation";

const pullRequest: NonNullable<VcsStatusResult["pr"]> = {
  number: 3774,
  title: "Desktop-style pull request indicator",
  url: "https://github.com/supabitapp/supacode-next/pull/3774",
  baseRef: "main",
  headRef: "codex/desktop-style-pr-indicator",
  state: "merged",
};

describe("presentThreadPr", () => {
  it("uses the compact pull request number label without a hash prefix", () => {
    expect(presentThreadPr(pullRequest, undefined)).toMatchObject({
      label: "3774",
      accessibilityLabel: "#3774 pull request merged",
      textClassName: "text-adaptive-violet-600-400",
    });
  });

  it("uses merge-request terminology for GitLab", () => {
    expect(
      presentThreadPr(pullRequest, {
        kind: SourceControlProviderKind.make("gitlab"),
        name: "GitLab",
        baseUrl: "https://gitlab.com",
      }),
    ).toMatchObject({
      label: "3774",
      accessibilityLabel: "#3774 merge request merged",
    });
  });

  it("uses gray for draft pull requests", () => {
    expect(
      presentThreadPr({ ...pullRequest, state: "open", isDraft: true }, undefined),
    ).toMatchObject({
      accessibilityLabel: "#3774 pull request draft",
      textClassName: "text-foreground-muted",
    });
  });
});

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
  it("renders unsynced links with neutral pending status", () => {
    expect(presentThreadLinkedPullRequests([linkedPr(1, { snapshot: null })])).toMatchObject({
      number: 1,
      label: "1",
      state: null,
      textClassName: "text-foreground-muted",
      accessibilityLabel: "#1 pull request status pending",
    });
  });

  it("counts unrelated links without labelling them a stack", () => {
    expect(presentThreadLinkedPullRequests([linkedPr(1), linkedPr(2)])).toMatchObject({
      kind: "pull-request",
      label: "+2",
      others: 1,
      state: "open",
      isDraft: false,
      textClassName: "text-adaptive-emerald-600-400",
    });
  });

  it.each([
    ["closed", false, "closed", false, "closed", false, "text-adaptive-rose-600-400"],
    ["open", true, "open", true, "open", true, "text-foreground-muted"],
    ["open", true, "open", false, "open", false, "text-adaptive-emerald-600-400"],
    ["closed", false, "open", false, "open", false, "text-adaptive-emerald-600-400"],
    ["merged", false, "merged", false, "merged", false, "text-adaptive-violet-600-400"],
    ["closed", false, "merged", false, "closed", false, "text-adaptive-rose-600-400"],
  ] as const)(
    "colors linked %s (draft %s) and %s (draft %s) by their aggregate state",
    (firstState, firstDraft, secondState, secondDraft, state, isDraft, textClassName) => {
      const first = linkedPr(1);
      const second = linkedPr(2);
      expect(
        presentThreadLinkedPullRequests([
          { ...first, snapshot: { ...first.snapshot!, state: firstState, isDraft: firstDraft } },
          {
            ...second,
            snapshot: { ...second.snapshot!, state: secondState, isDraft: secondDraft },
          },
        ]),
      ).toMatchObject({
        label: "+2",
        state,
        isDraft,
        textClassName,
        accessibilityLabel: `2 linked pull requests, overall ${isDraft ? "draft" : state}`,
      });
    },
  );

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

  it("hides dismissed stack members", () => {
    expect(
      presentThreadLinkedPullRequests([linkedPr(1, { source: "stack-dismissed" })]),
    ).toBeNull();
  });

  it("retains merged state from the persisted snapshot", () => {
    const link = linkedPr(1);
    expect(
      presentThreadLinkedPullRequests([
        { ...link, snapshot: { ...link.snapshot!, state: "merged" } },
      ]),
    ).toMatchObject({ state: "merged", textClassName: "text-adaptive-violet-600-400" });
  });
});

describe("resolveThreadPrBadgeAction", () => {
  it("opens a single linked or branch pull request directly", () => {
    expect(resolveThreadPrBadgeAction(presentThreadLinkedPullRequests([linkedPr(1)])!)).toEqual({
      kind: "open",
      accessibilityLabel: "Open #1 pull request open",
    });
    expect(resolveThreadPrBadgeAction(presentThreadPr(pullRequest, null))).toMatchObject({
      kind: "open",
    });
  });

  it("lists unrelated linked pull requests", () => {
    expect(
      resolveThreadPrBadgeAction(presentThreadLinkedPullRequests([linkedPr(1), linkedPr(2)])!),
    ).toEqual({
      kind: "list",
      accessibilityLabel: "Show 2 linked pull requests, overall open",
    });
  });

  it("lists a stack even though the badge shows its top pull request", () => {
    const top = linkedPr(2);
    const stack = presentThreadLinkedPullRequests([
      linkedPr(1),
      { ...top, snapshot: { ...top.snapshot!, baseBranch: "change-1" } },
    ])!;
    expect(resolveThreadPrBadgeAction(stack)).toMatchObject({ kind: "list" });
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
