import { SourceControlProviderKind } from "./sourceControl.ts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  PullRequestCapabilities,
  PullRequestListedAction,
  PullRequestDetail,
  PullRequestListResult,
  PullRequestViewerPermissions,
  pullRequestActionAllowed,
  resolvePullRequestAuthorFilter,
} from "./pullRequest.ts";

const decodeListResult = Schema.decodeUnknownSync(Schema.toCodecJson(PullRequestListResult));
const decodeDetail = Schema.decodeUnknownSync(Schema.toCodecJson(PullRequestDetail));

const LIST_RESULT: PullRequestListResult = {
  viewers: { "github.com": "bilal", "gitlab.com": "bilal.hassan" },
  providers: [
    {
      host: "github.com",
      kind: SourceControlProviderKind.make("github"),
      searchesOnHost: true,
      projectCount: 1,
      configured: true,
      detail: null,
    },
    {
      host: "gitlab.com",
      kind: SourceControlProviderKind.make("gitlab"),
      searchesOnHost: true,
      projectCount: 1,
      configured: false,
      detail: "glab is not installed.",
    },
  ],
  entries: [
    {
      provider: SourceControlProviderKind.make("github"),
      host: "github.com",
      projectId: "project-1" as PullRequestListResult["entries"][number]["projectId"],
      projectTitle: "supaterm",
      repository: "supabitapp/supaterm",
      number: 1,
      title: "Add a pull requests page",
      url: "https://github.com/supabitapp/supaterm/pull/1",
      author: { login: "octocat", name: null, avatarUrl: null },
      headBranch: "feat/page",
      baseBranch: "main",
      state: "open",
      isDraft: false,
      mergeability: "mergeable",
      additions: 1,
      deletions: 0,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-02T00:00:00Z",
      viewerReviewRequested: false,
      labels: [{ name: "backend", color: null }],
    },
  ],
  errors: [],
  truncated: false,
  nextCursors: { "github.com supabitapp/supaterm": "2026-07-02T00:00:00Z|1|1" },
};

describe("PullRequestListResult", () => {
  /**
   * The RPC builds this codec at call time, so a shape it cannot lower — an open-keyed record
   * with an optional value, for one — fails as an interrupted request rather than as a schema
   * error.
   */
  it("round-trips through the JSON codec the RPC serializes with", () => {
    const codec = Schema.toCodecJson(PullRequestListResult);

    const decoded = Schema.decodeSync(codec)(Schema.encodeUnknownSync(codec)(LIST_RESULT));

    expect(decoded).toStrictEqual(LIST_RESULT);
  });
});

describe("PullRequestCapabilities", () => {
  const base = {
    diff: true,
    comment: true,
    actions: [],
    mergeMethods: [],
    search: true,
    review: { inlineComment: true, reply: true, resolve: true, verdicts: [] },
    reviewers: { request: true, listCandidates: true },
  };

  it("loads a newer server's detail response, dropping unknown options in order", () => {
    const options = {
      actions: ["close", "archive", "merge"],
      verdicts: ["request-changes", "block", "approve"],
      updateMethods: ["rebase", "fast-forward", "merge"],
    };
    const detail = {
      ...LIST_RESULT.entries[0],
      workspaceRoot: "/workspace/supaterm",
      body: "",
      changedFiles: 1,
      mergedAt: null,
      closedAt: null,
      reviewers: [],
      checks: [],
      mergeCapabilities: { merge: true, squash: true, rebase: true },
      capabilities: {
        ...base,
        actions: options.actions,
        mergeMethods: ["squash", "fast-forward", "merge"],
        updateMethods: options.updateMethods,
        review: { ...base.review, verdicts: options.verdicts },
      },
      viewerPermissions: { ...options, comment: true, resolve: true, requestReviewers: true },
    };
    const decoded = decodeDetail(detail);

    expect(decoded.capabilities).toEqual({
      ...base,
      actions: ["close", "merge"],
      mergeMethods: ["squash", "merge"],
      updateMethods: ["rebase", "merge"],
      review: { ...base.review, verdicts: ["request-changes", "approve"] },
    });
    expect(decoded.viewerPermissions).toEqual({
      actions: ["close", "merge"],
      verdicts: ["request-changes", "approve"],
      updateMethods: ["rebase", "merge"],
      comment: true,
      resolve: true,
      requestReviewers: true,
    });
    expect(decoded.title).toBe(detail.title);
  });
});

describe("action lists from a newer server", () => {
  const decodeCapabilities = Schema.decodeUnknownSync(PullRequestCapabilities);
  const decodePermissions = Schema.decodeUnknownSync(PullRequestViewerPermissions);
  const capabilities = {
    diff: true,
    comment: true,
    actions: ["merge", "summon-reviewer", "close"],
    mergeMethods: [],
    search: true,
    review: { inlineComment: true, reply: true, resolve: true, verdicts: [] },
    reviewers: { request: true, listCandidates: true },
  };
  const permissions = {
    actions: ["summon-reviewer", "reopen"],
    comment: true,
    resolve: true,
    verdicts: [],
    requestReviewers: false,
  };

  it("drops actions this build does not know instead of failing the payload", () => {
    expect(decodeCapabilities(capabilities).actions).toEqual(["merge", "close"]);
    expect(decodePermissions(permissions).actions).toEqual(["reopen"]);
    const [provider] = LIST_RESULT.providers;
    expect(
      decodeListResult({
        ...LIST_RESULT,
        providers: [{ ...provider, actions: ["merge", "summon-reviewer"] }],
      }).providers[0]?.actions,
    ).toEqual(["merge"]);
  });

  it("keeps the listed actions to what v26.10.1 clients decode", () => {
    expect(new Set(PullRequestListedAction.literals)).toEqual(
      new Set([
        "merge",
        "ready",
        "draft",
        "close",
        "reopen",
        "update-branch",
        "enable-auto-merge",
        "disable-auto-merge",
        "revert",
        "approve-workflows",
      ]),
    );
  });

  it("reads branch deletion from its flags, not from the lists", () => {
    const listed = { ...decodeCapabilities(capabilities), actions: ["merge"] as const };
    expect(pullRequestActionAllowed(listed, "delete-branch")).toBe(false);
    expect(pullRequestActionAllowed({ ...listed, deleteBranch: true }, "delete-branch")).toBe(true);
    expect(pullRequestActionAllowed(listed, "merge")).toBe(true);
    const viewer = decodePermissions({ ...permissions, deleteBranch: true });
    expect(pullRequestActionAllowed(viewer, "delete-branch")).toBe(true);
    expect(pullRequestActionAllowed(decodePermissions(permissions), "delete-branch")).toBe(false);
    expect(pullRequestActionAllowed(viewer, "merge")).toBe(false);
  });
});

describe("resolvePullRequestAuthorFilter", () => {
  it("reads me as the signed-in account on the host", () => {
    expect(resolvePullRequestAuthorFilter("me", "bilal")).toBe("bilal");
    expect(resolvePullRequestAuthorFilter(" @Me ", "bilal")).toBe("bilal");
  });

  it("keeps me as a literal login when the host has no viewer", () => {
    expect(resolvePullRequestAuthorFilter("me", null)).toBe("me");
    expect(resolvePullRequestAuthorFilter("@me", " ")).toBe("@me");
  });

  it("passes any other login through trimmed", () => {
    expect(resolvePullRequestAuthorFilter(" ana ", "bilal")).toBe("ana");
    expect(resolvePullRequestAuthorFilter("meredith", "bilal")).toBe("meredith");
  });
});
