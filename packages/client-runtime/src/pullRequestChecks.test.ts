import type { PullRequestCheck, PullRequestDetail } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { recordPullRequestObservation } from "./pullRequestObservation.ts";

import { resolvePullRequestDetailChecks } from "./pullRequestChecks.ts";

const detail = (overrides: Partial<PullRequestDetail> = {}): PullRequestDetail =>
  ({ title: "Cache the title", state: "open", checks: [], ...overrides }) as PullRequestDetail;

describe("resolvePullRequestDetailChecks", () => {
  it("uses fresh checks for detail counts without replacing other PR fields", () => {
    const pending = (name: string): PullRequestCheck => ({
      name,
      status: "pending",
      url: null,
      description: null,
    });
    const original = detail({ checks: [pending("build"), pending("test")] });
    const checks = [pending("build"), { ...pending("test"), status: "success" as const }];
    expect(resolvePullRequestDetailChecks(original, { state: "closed", checks }, true)).toEqual({
      ...original,
      state: "closed",
      checks,
    });
    expect(resolvePullRequestDetailChecks(original, { state: "closed", checks }, false)).toBe(
      original,
    );
    expect(resolvePullRequestDetailChecks(original, null, true)).toBe(original);
    expect(resolvePullRequestDetailChecks(null, { state: "closed", checks }, true)).toBeNull();
  });

  it("keeps newer checks when an older cached detail arrives later", () => {
    const pending: PullRequestCheck = {
      name: "build",
      status: "pending",
      url: null,
      description: null,
    };
    const cached = recordPullRequestObservation(
      detail({ observedAt: 1_000, checks: [pending] }),
      "host-a",
    );
    const checks = {
      state: "open" as const,
      checks: [{ ...pending, status: "success" as const }],
      observedAt: 2_000,
    };
    recordPullRequestObservation(checks, "host-a");
    const resolved = resolvePullRequestDetailChecks(cached, checks, false);
    expect(resolved?.checks).toEqual(checks.checks);
    expect(resolved?.observedAt).toBe(1_000);
    expect(
      resolvePullRequestDetailChecks(cached, { state: checks.state, checks: checks.checks }, true)
        ?.checks,
    ).toEqual(checks.checks);
    const refreshed = recordPullRequestObservation(
      detail({ observedAt: 3_000, checks: [pending] }),
      "host-a",
    );
    expect(resolvePullRequestDetailChecks(refreshed, checks, true)).toBe(refreshed);
  });

  it("keeps merged details settled while applying newer checks", () => {
    const merged = detail({ state: "merged", observedAt: 1_000 });
    const checks = [{ name: "build", status: "success" as const, url: null, description: null }];
    expect(
      resolvePullRequestDetailChecks(merged, { state: "open", observedAt: 2_000, checks }, true),
    ).toEqual({ ...merged, checks });
  });
  it("uses arrival order for different servers and restored observations", () => {
    const cached = recordPullRequestObservation(detail({ observedAt: 9_000 }), "fast-clock");
    const checks = recordPullRequestObservation(
      { state: "closed" as const, checks: [], observedAt: 1_000 },
      "slow-clock",
    );
    expect(resolvePullRequestDetailChecks(cached, checks, true)?.state).toBe("closed");
    expect(resolvePullRequestDetailChecks(cached, checks, false)).toBe(cached);
    const restored = detail({ observedAt: 9_000 });
    expect(resolvePullRequestDetailChecks(restored, checks, true)?.state).toBe("closed");
  });
});
