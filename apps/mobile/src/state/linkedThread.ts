import { useAtomValue } from "@effect/atom-react";
import type { LinkedThreadTarget } from "@supaterm/client-runtime/linked-thread";
import type { EnvironmentId, OrchestrationV2Subagent } from "@supaterm/contracts";

import { useEnvironments } from "./environments";
import {
  peerLinkEnvironment,
  useLinkedEnvironments,
  useSupportsLinkedThreadReads,
} from "./peerLinks";
import { useEnvironmentQuery } from "./query";

/**
 * What places a delegated task's thread: this app's own connections, and the links `environmentId`
 * holds. Links are listed only while a task runs somewhere this app is not connected to.
 * `isLinked` is null while `environmentId` is from before it could read its links' threads.
 */
export function useLinkedThreadReach(
  environmentId: EnvironmentId,
  subagents: ReadonlyArray<Pick<OrchestrationV2Subagent, "childThreadId" | "remoteChild">>,
) {
  const { presentationById } = useEnvironments();
  const ownConnection = (id: EnvironmentId) => {
    const own = presentationById.get(id);
    return own && { connected: own.connection.phase === "connected" };
  };
  const reads = useSupportsLinkedThreadReads(environmentId);
  const links = useLinkedEnvironments(
    reads &&
      subagents.some(
        (subagent) =>
          subagent.childThreadId === null &&
          subagent.remoteChild !== undefined &&
          ownConnection(subagent.remoteChild.environmentId)?.connected !== true,
      )
      ? environmentId
      : null,
  );
  return { ownConnection, isLinked: reads ? (id: EnvironmentId) => links.has(id) : null };
}

/**
 * The thread of `target`, streamed through the environment that links to it. The stream runs only
 * while `active`; what it last showed stays, so coming back to the screen shows it at once.
 */
export function useLinkedThreadView(target: LinkedThreadTarget, active: boolean) {
  const viewTarget = {
    environmentId: target.viaEnvironmentId,
    input: { environmentId: target.environmentId, threadId: target.threadId },
  };
  const live = useEnvironmentQuery(active ? peerLinkEnvironment.threadView(viewTarget) : null);
  const view = useAtomValue(peerLinkEnvironment.lastThreadView(viewTarget));
  return {
    view,
    /** Why the stream is not running: it ended, or it waits to ask again. */
    error: live.failure ?? view?.error ?? null,
    /** Asks again now. */
    retry: live.refresh,
  };
}
