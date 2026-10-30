import { useFocusEffect } from "@react-navigation/native";
import {
  pullRequestChecksRefreshIntervalMs,
  resolvePullRequestDetailChecks,
} from "@supaterm/client-runtime/pull-request-checks";
import type { PullRequestDetail } from "@supaterm/contracts";
import { useEnvironmentServerConfig } from "../../state/entities";
import { composerPullRequests } from "../../state/pull-requests";
import { useEnvironmentQuery } from "../../state/query";
import { usePullRequestConnected } from "./usePullRequestConnected";
import { pullRequestTarget, type PullRequestParams } from "./usePullRequestDiff";

export function usePullRequestLiveChecks(
  params: PullRequestParams,
  detail: PullRequestDetail | null,
): PullRequestDetail | null {
  const target = pullRequestTarget(params);
  const connected = usePullRequestConnected(target.environmentId);
  const supported = useEnvironmentServerConfig(target.environmentId) != null;
  const checks = useEnvironmentQuery(
    supported && detail !== null ? composerPullRequests.checks(target) : null,
  );

  const live = resolvePullRequestDetailChecks(detail, checks.data, true);

  const enabled =
    connected && supported && live?.state === "open" && !(checks.isSuccess && checks.data === null);
  const intervalMs = pullRequestChecksRefreshIntervalMs(live?.checks ?? []);
  const { refresh } = checks;
  useFocusEffect(() => {
    if (!enabled) return;
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  });
  return live;
}
