import { StackActions, useNavigation } from "@react-navigation/native";
import { resolveLinkedThreadOpen } from "@supaterm/client-runtime/linked-thread";
import type { EnvironmentId, ScopedThreadRef } from "@supaterm/contracts";

import { useEnvironments } from "../../state/environments";
import { useLinkedEnvironments, useSupportsLinkedThreadReads } from "../../state/peerLinks";
import { linkedThreadRouteParams } from "./LinkedThreadSheet";
import { useOpenLinkedThread } from "./useOpenLinkedThread";

/**
 * Opens a thread that a link or chip in `viaEnvironmentId` points at: in place when this app is
 * connected to its environment, else read-only through `viaEnvironmentId`'s link to it.
 */
export function useOpenThreadLink(viaEnvironmentId: EnvironmentId | null) {
  const navigation = useNavigation();
  const openThread = useOpenLinkedThread();
  const reads = useSupportsLinkedThreadReads(viaEnvironmentId);
  const linkedEnvironments = useLinkedEnvironments(reads ? viaEnvironmentId : null);
  const { presentationById } = useEnvironments();
  return (thread: ScopedThreadRef, title: string | null = null) => {
    const label = linkedEnvironments.get(thread.environmentId);
    const own = presentationById.get(thread.environmentId);
    if (
      viaEnvironmentId !== null &&
      label !== undefined &&
      resolveLinkedThreadOpen({
        environmentId: thread.environmentId,
        viaEnvironmentId,
        own: own && { connected: own.connection.phase === "connected" },
        linked: true,
      }) === "linked"
    ) {
      navigation.dispatch(
        StackActions.push(
          "LinkedThread",
          linkedThreadRouteParams(thread, { viaEnvironmentId, label }, title),
        ),
      );
      return;
    }
    openThread({
      environmentId: String(thread.environmentId),
      threadId: String(thread.threadId),
    });
  };
}
