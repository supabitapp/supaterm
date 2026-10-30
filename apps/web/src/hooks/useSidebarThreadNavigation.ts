import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useSidebar } from "../components/ui/sidebar";
import { createThreadNavigation } from "../lib/threadNavigation";
import { readThreadShell, waitForSidebarThreadShell } from "../state/entities";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { buildThreadRouteParams } from "../threadRoutes";
import { readPendingThreadCreation } from "../state/threadOutbox";
import { useStableCallback } from "./useStableCallback";

export function useSidebarThreadNavigation() {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const { isMobile, setOpenMobile } = useSidebar();
  const openThread = useStableCallback((threadRef: ScopedThreadRef) => {
    const selection = useThreadSelectionStore.getState();
    if (selection.hasSelection()) selection.clearSelection();
    selection.setAnchor(scopedThreadKey(threadRef));
    if (isMobile) setOpenMobile(false);
    return router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  });
  // The navigation tracks the pending request, so one instance lives as long as the sidebar.
  const [navigation] = useState(() =>
    createThreadNavigation({
      getLocation: () => router.state.location,
      isReady: (threadRef) =>
        readThreadShell(threadRef) !== null || readPendingThreadCreation(threadRef) !== null,
      waitForThread: waitForSidebarThreadShell,
      navigate: openThread,
    }),
  );
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Cancels pending asynchronous router navigation when the sidebar unmounts.
  useEffect(() => () => navigation.cancel(), [navigation]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Cancels pending router navigation when another navigation changes the location.
  useEffect(
    () => () => {
      if (router.state.location !== location) navigation.cancel();
    },
    [location, navigation, router],
  );
  return navigation.navigate;
}
