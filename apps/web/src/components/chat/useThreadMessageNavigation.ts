import type { ScopedThreadRef } from "@supaterm/contracts";
import { use, useEffect, useEffectEvent } from "react";

import { useIsPaneInputOwner } from "../../chatPanes/paneScope";
import {
  subscribeThreadMessageNavigation,
  takeThreadMessageNavigation,
  type ThreadMessageNavigation,
} from "../../lib/threadMessageNavigation";
import { BackgroundThreadContext } from "./backgroundThread";

export function useThreadMessageNavigation(
  threadRef: ScopedThreadRef | null,
  onNavigate: (request: ThreadMessageNavigation) => void,
) {
  const focused = useIsPaneInputOwner();
  const background = use(BackgroundThreadContext);
  const navigate = useEffectEvent(onNavigate);
  const environmentId = threadRef?.environmentId;
  const threadId = threadRef?.threadId;

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Consume shell navigation requests only while this foreground pane owns the destination thread.
  useEffect(() => {
    if (!focused || background || environmentId === undefined || threadId === undefined) return;
    const target = { environmentId, threadId };
    const consume = () => {
      const request = takeThreadMessageNavigation(target);
      if (request !== null) navigate(request);
    };
    const stop = subscribeThreadMessageNavigation((request) => {
      if (
        request.threadRef.environmentId === environmentId &&
        request.threadRef.threadId === threadId
      )
        consume();
    });
    consume();
    return stop;
  }, [background, environmentId, focused, threadId]);
}
