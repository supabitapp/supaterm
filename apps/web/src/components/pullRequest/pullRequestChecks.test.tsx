import type { EnvironmentId, ProjectId, PullRequestCheck } from "@supaterm/contracts";
import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";

import { PullRequestChecksPopover } from "./PullRequestChecksPopover";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";
import { PullRequestRow } from "./PullRequestRow";
import {
  pullRequestChecksState,
  pullRequestCheckStatusLabel,
  pullRequestChecksRingSegments,
  summarizePullRequestChecks,
} from "./pullRequestPresentation";

function check(
  status: PullRequestCheck["status"],
  overrides: Partial<PullRequestCheck> = {},
): PullRequestCheck {
  return { name: `check-${status}`, status, description: null, url: null, ...overrides };
}

describe("pullRequestChecksState", () => {
  it("lets a failure outrank a run still going, and reports nothing without checks", () => {
    expect(pullRequestChecksState([check("success"), check("pending"), check("failure")])).toBe(
      "failing",
    );
    expect(pullRequestChecksState([check("success"), check("cancelled")])).toBe("failing");
    expect(pullRequestChecksState([check("success"), check("pending")])).toBe("pending");
    expect(pullRequestChecksState([check("success"), check("action-required")])).toBe("pending");
    expect(pullRequestChecksState([check("success")])).toBe("passing");
    expect(pullRequestChecksState([check("skipped"), check("neutral")])).toBe(null);
    expect(pullRequestChecksState([])).toBe(null);
  });

  it("names workflow approval instead of claiming every check passed", () => {
    const workflow = check("action-required", {
      url: "https://github.com/acme/web/actions/runs/42/job/7",
    });
    const manualGate = check("action-required", { url: "https://example.com/manual-gate" });
    expect(pullRequestCheckStatusLabel(workflow)).toBe("Awaiting approval");
    expect(pullRequestCheckStatusLabel(manualGate)).toBe("Awaiting action");
    expect(summarizePullRequestChecks([check("success"), workflow])).toBe(
      "1 successful check, 1 workflow awaiting approval",
    );
    expect(summarizePullRequestChecks([check("failure"), workflow])).toBe(
      "1 failing check, 1 workflow awaiting approval",
    );
    expect(summarizePullRequestChecks([check("success"), manualGate])).toBe(
      "1 successful check, 1 check awaiting action",
    );
    expect(summarizePullRequestChecks([workflow, manualGate])).toBe(
      "1 workflow awaiting approval, 1 check awaiting action",
    );
  });
});

describe("summarizePullRequestChecks", () => {
  it("shows GitHub-style counts for every reported outcome", () => {
    expect(
      summarizePullRequestChecks([
        ...Array.from({ length: 2 }, () => check("failure")),
        ...Array.from({ length: 3 }, () => check("skipped")),
        ...Array.from({ length: 25 }, () => check("success")),
      ]),
    ).toBe("2 failing, 3 skipped, 25 successful checks");
    expect(
      summarizePullRequestChecks([
        ...Array.from({ length: 13 }, () => check("pending")),
        ...Array.from({ length: 40 }, () => check("success")),
      ]),
    ).toBe("13 pending, 40 successful checks");
  });

  it("keeps pending and neutral results visible when another check fails", () => {
    expect(
      summarizePullRequestChecks([
        check("failure"),
        check("cancelled"),
        check("pending"),
        check("neutral"),
        check("success"),
      ]),
    ).toBe("2 failing, 1 pending, 1 neutral, 1 successful checks");
  });

  it("omits absent outcomes and handles single checks and an empty list", () => {
    expect(summarizePullRequestChecks([])).toBe("No checks reported");
    expect(summarizePullRequestChecks([check("success")])).toBe("1 successful check");
    expect(summarizePullRequestChecks([check("skipped"), check("skipped")])).toBe(
      "2 skipped checks",
    );
    expect(summarizePullRequestChecks([check("neutral")])).toBe("1 neutral check");
  });
});

describe("pullRequestChecksRingSegments", () => {
  it("includes every verdict in its proportion of the ring", () => {
    const segments = pullRequestChecksRingSegments([
      check("failure"),
      check("cancelled"),
      check("pending"),
      check("action-required"),
      check("skipped"),
      check("neutral"),
      check("success"),
      check("success"),
    ]);
    expect(segments).toEqual([
      { status: "failure", count: 2, start: 0, length: 25 },
      { status: "pending", count: 2, start: 25, length: 25 },
      { status: "skipped", count: 2, start: 50, length: 25 },
      { status: "success", count: 2, start: 75, length: 25 },
    ]);
  });

  it("shows completed checks while the last check is running", () => {
    const segments = pullRequestChecksRingSegments([
      ...Array.from({ length: 53 }, () => check("success")),
      check("pending"),
    ]);
    expect(segments.map(({ status, count }) => ({ status, count }))).toEqual([
      { status: "pending", count: 1 },
      { status: "success", count: 53 },
    ]);
    expect(segments[0]?.length).toBeCloseTo(100 / 54);
    expect(segments[1]?.length).toBeCloseTo((53 / 54) * 100);
  });

  it("handles empty and uniform check results", () => {
    expect(pullRequestChecksRingSegments([])).toEqual([]);
    for (const status of ["success", "failure", "pending", "skipped"] as const) {
      expect(pullRequestChecksRingSegments([check(status)])).toEqual([
        { status, count: 1, start: 0, length: 100 },
      ]);
    }
  });
});

function flatten(node: ReactNode): ReadonlyArray<ReturnType<typeof Object>> {
  const found: unknown[] = [];
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    found.push(child);
    for (const value of Object.values(child.props as Record<string, unknown>)) {
      if (isValidElement(value)) found.push(...flatten(value));
      else if (Array.isArray(value)) found.push(...flatten(value.filter(isValidElement)));
    }
  }
  return found as ReadonlyArray<ReturnType<typeof Object>>;
}

function entry(overrides: Partial<EnvironmentPullRequestEntry>): EnvironmentPullRequestEntry {
  return {
    environmentId: "env-1" as EnvironmentId,
    projectId: "project-1" as ProjectId,
    provider: "github",
    repository: "supabitapp/supacode-next",
    number: 1,
    title: "Add the pull requests page",
    url: "https://github.com/supabitapp/supacode-next/pull/1",
    author: null,
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
    labels: [],
    ...overrides,
  } as EnvironmentPullRequestEntry;
}

function row(overrides: Partial<EnvironmentPullRequestEntry>): ReactNode {
  return PullRequestRow.type({
    entry: entry(overrides),
    selected: false,
    showProjectTitle: false,
    showProvider: false,
    onSelect: () => {},
    hostActions: new Set(),
    onActed: () => {},
  });
}

describe("PullRequestRow checks indicator", () => {
  function indicators(node: ReactNode): number {
    return flatten(node).filter(
      (element) => (element as { type?: unknown }).type === PullRequestChecksPopover,
    ).length;
  }

  it("shows the indicator only for a row the host reported a rollup for", () => {
    expect(indicators(row({ checksState: "failing" }))).toBe(1);
    expect(indicators(row({}))).toBe(0);
  });
});
