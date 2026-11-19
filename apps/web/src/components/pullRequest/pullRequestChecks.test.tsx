import type { PullRequestCheck } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
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
