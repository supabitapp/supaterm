import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import { EnvironmentId, ProjectId, type ScopedThreadRef } from "@supaterm/contracts";

import {
  readPullRequestDetailSnapshot,
  resolvePullRequestReferenceHost,
} from "../components/pullRequest/pullRequestDetail.logic";
import { projectChangeRequestUrl } from "@supaterm/client-runtime/change-request-links";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { useProject } from "../state/entities";
import { pullRequestEnvironment } from "../state/pullRequests";
import { useEnvironmentQuery } from "../state/query";

type PanelPullRequestSurface = Extract<
  NonNullable<ReturnType<typeof selectActiveRightPanelSurface>>,
  { kind: "pull-request" }
>;

function panelPullRequestReference(
  requestedReference: PanelPullRequestSurface | null,
  repositoryIdentity: Parameters<typeof resolvePullRequestReferenceHost>[1],
) {
  if (requestedReference === null) return null;
  return resolvePullRequestReferenceHost(
    {
      projectId: ProjectId.make(requestedReference.projectId),
      repository: requestedReference.repository,
      number: requestedReference.number,
      ...(requestedReference.host === undefined ? {} : { host: requestedReference.host }),
    },
    repositoryIdentity,
  );
}

export function useOpenPanelPullRequestUrl(threadRef: ScopedThreadRef | null) {
  const surface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, threadRef),
  );
  const requestedReference = surface?.kind === "pull-request" ? surface : null;
  const environmentId = requestedReference?.environmentId
    ? EnvironmentId.make(requestedReference.environmentId)
    : threadRef?.environmentId;
  const project = useProject(
    requestedReference && environmentId
      ? scopeProjectRef(environmentId, ProjectId.make(requestedReference.projectId))
      : null,
  );
  const reference = panelPullRequestReference(requestedReference, project?.repositoryIdentity);
  // Everything that reads reference or the project runs before the query hook; a plain
  // call on either after it would leave reference, and the detail atom it keys, uncached.
  // The snapshot is already checked against reference, so live detail just wins below.
  const cachedDetail =
    reference && environmentId
      ? readPullRequestDetailSnapshot(
          typeof window === "undefined" ? undefined : window.localStorage,
          environmentId,
          reference,
        )
      : null;
  const fallbackUrl = reference
    ? (requestedReference?.url ??
      projectChangeRequestUrl(project?.repositoryIdentity, reference.repository, reference.number))
    : undefined;
  const detail = useEnvironmentQuery(
    reference && environmentId
      ? pullRequestEnvironment.detail({
          environmentId,
          input: { ...reference, allowStale: false },
        })
      : null,
  ).data;
  return reference ? ((detail ?? cachedDetail)?.url ?? fallbackUrl) : undefined;
}
