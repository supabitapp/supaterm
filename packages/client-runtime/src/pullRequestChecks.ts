import {
  preservePullRequestObservation,
  pullRequestObservationsShareSource,
} from "./pullRequestObservation.ts";
import type { PullRequestCheck, PullRequestChecks, PullRequestDetail } from "@supaterm/contracts";

export function resolvePullRequestDetailChecks(
  detail: PullRequestDetail | null,
  checks: PullRequestChecks | null,
  checksAreNewer: boolean,
): PullRequestDetail | null {
  if (detail === null || checks === null) return detail;
  const newer =
    pullRequestObservationsShareSource(detail, checks) &&
    detail.observedAt !== undefined &&
    checks.observedAt !== undefined
      ? checks.observedAt >= detail.observedAt
      : checksAreNewer;
  return newer
    ? preservePullRequestObservation(detail, {
        ...detail,
        state: detail.state === "merged" ? "merged" : checks.state,
        checks: checks.checks,
      })
    : detail;
}

export function pullRequestChecksRefreshIntervalMs(
  checks: ReadonlyArray<PullRequestCheck>,
): number {
  return checks.length === 0 ||
    checks.some((check) => check.status === "pending" || check.status === "action-required")
    ? 45_000
    : 60_000;
}
