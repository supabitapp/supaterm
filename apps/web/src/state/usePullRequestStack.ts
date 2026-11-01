import { useAtomValue } from "@effect/atom-react";
import {
  ThreadPullRequestLink,
  type EnvironmentId,
  type PullRequestDetail,
  type PullRequestRef,
} from "@supaterm/contracts";
import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { allowsSinglePullRequestMerge } from "../components/pullRequest/pullRequestDetail.logic";
import {
  savedPullRequestStack,
  pullRequestStackView,
} from "../components/pullRequest/pullRequestStackSnapshot";
import { pullRequestStackAtom } from "./pullRequests";
import { useEnvironmentQuery } from "./query";
import { environmentThreadShells } from "./threads";

const sameLinks = Schema.toEquivalence(Schema.Array(ThreadPullRequestLink));

// Shell pushes recreate link arrays; reuse equal lists so streaming does not re-render the stack.
const environmentPullRequestLinksAtom = Atom.family((environmentId: EnvironmentId) => {
  let previous: ReadonlyArray<ThreadPullRequestLink> = [];
  return Atom.make((get) => {
    const next = get(environmentThreadShells.environmentThreadsAtom(environmentId)).flatMap(
      (thread) => thread.pullRequests ?? [],
    );
    if (sameLinks(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`web-environment-pull-request-links:${environmentId}`));
});

export function usePullRequestStack(
  environmentId: EnvironmentId,
  reference: PullRequestRef | null,
) {
  const links = useAtomValue(environmentPullRequestLinksAtom(environmentId));
  const saved = reference === null ? null : savedPullRequestStack(links, reference);
  const query = useEnvironmentQuery(
    reference === null ? null : pullRequestStackAtom({ environmentId, input: reference }),
  );
  return { ...query, ...pullRequestStackView(query, saved) };
}

function pullRequestStackReference(
  detail: Pick<PullRequestDetail, "url" | "capabilities"> | null,
  reference: PullRequestRef | null,
) {
  return detail === null || reference === null || detail.capabilities.stacks !== true
    ? null
    : {
        ...reference,
        host: reference.host ?? sourceControlClients.parseChangeRequestUrl(detail.url)?.link.host,
      };
}

/** A pull request in a native stack merges with its stack, never on its own. */
export function usePullRequestStackGate({
  environmentId,
  reference,
  detail,
  environmentSupported,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef | null;
  detail: Pick<PullRequestDetail, "url" | "capabilities"> | null;
  environmentSupported: boolean;
}) {
  const stackQuery = usePullRequestStack(
    environmentId,
    pullRequestStackReference(detail, reference),
  );
  const supportsStackActions =
    detail?.capabilities.stacks === true &&
    detail.capabilities.stackActions === true &&
    environmentSupported;
  return {
    stackQuery,
    supportsStackActions,
    canMergeSinglePullRequest: allowsSinglePullRequestMerge({
      supportsStackActions,
      hasStack: stackQuery.data !== null,
      stackPending: !stackQuery.isFresh,
      stackError: stackQuery.error,
    }),
  };
}
