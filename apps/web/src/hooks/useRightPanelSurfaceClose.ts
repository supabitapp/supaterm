import {
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import { getTerminalLabel } from "@supaterm/shared/terminalLabels";
import { closePreviewSession } from "../components/preview/closePreviewSession";
import { useThreadTerminalActions } from "../components/terminal/useThreadTerminalActions";
import { confirmRightPanelSurfacesClose } from "../lib/rightPanelCloseConfirm";
import { setActivePreviewTab, useThreadPreviewState } from "../previewStateStore";
import {
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../rightPanelStore";
import { previewEnvironment } from "../state/preview";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { useStableCallback } from "./useStableCallback";

/**
 * Closes right panel surfaces for a thread. A surface's live resources go with
 * it: a browser's preview session and a terminal tab's sessions. One confirm
 * covers every browser an agent is driving and every terminal in the batch.
 */
export function useRightPanelSurfaceClose(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly terminalLabelsById: ReadonlyMap<string, string>;
  readonly terminalHasRunningSubprocessById: ReadonlyMap<string, boolean>;
}) {
  const { threadRef, terminalLabelsById, terminalHasRunningSubprocessById } = input;
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const canOperatePreview = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
  const previewState = useThreadPreviewState(threadRef);
  const terminalActions = useThreadTerminalActions(threadRef);
  const storeCloseTerminal = useTerminalUiStateStore((state) => state.closeTerminal);
  const surfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );

  const releaseSurfaceResources = (ref: ScopedThreadRef, surface: RightPanelSurface) => {
    if (canOperatePreview && surface.kind === "preview" && surface.resourceId) {
      void closePreviewSession({
        closePreview,
        snapshot: previewState.sessions[surface.resourceId] ?? null,
        tabId: surface.resourceId,
        threadRef: ref,
      });
    }
    if (
      surface.kind === "terminal" &&
      readEnvironmentScope(ref.environmentId, AuthTerminalOperateScope)
    ) {
      for (const terminalId of surface.terminalIds) {
        storeCloseTerminal(ref, terminalId);
        terminalActions.closeTerminalSession(terminalId);
      }
    }
  };
  // The active surface closes last so the panel does not flash through it.
  const finishClose = (toClose: readonly RightPanelSurface[]) => {
    if (!threadRef) return;
    const store = useRightPanelStore.getState();
    const activeId = selectThreadRightPanelState(store.byThreadKey, threadRef).activeSurfaceId;
    const ordered = toClose.toSorted(
      (left, right) => Number(left.id === activeId) - Number(right.id === activeId),
    );
    for (const surface of ordered) {
      releaseSurfaceResources(threadRef, surface);
      store.closeSurface(threadRef, surface.id);
    }
    const nextActiveSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    );
    if (nextActiveSurface?.kind === "preview" && nextActiveSurface.resourceId) {
      setActivePreviewTab(threadRef, nextActiveSurface.resourceId);
    }
  };
  const terminalCloseTarget = (terminalId: string) => ({
    label: terminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId),
    hasRunningSubprocess: terminalHasRunningSubprocessById.get(terminalId) ?? false,
  });
  const closeSurfaces = (toClose: readonly RightPanelSurface[]) => {
    if (!threadRef) return;
    void confirmRightPanelSurfacesClose(
      toClose.filter(
        (surface) =>
          surface.kind !== "terminal" ||
          readEnvironmentScope(threadRef.environmentId, AuthTerminalOperateScope),
      ),
      { desktopByTabId: previewState.desktopByTabId, terminalCloseTarget },
    ).then((confirmed) => {
      if (confirmed) finishClose(toClose);
    });
  };

  const closeSurface = useStableCallback((surface: RightPanelSurface) => closeSurfaces([surface]));
  const closeOtherSurfaces = useStableCallback((surface: RightPanelSurface) =>
    closeSurfaces(surfaces.filter((entry) => entry.id !== surface.id)),
  );
  const closeSurfacesToRight = useStableCallback((surface: RightPanelSurface) => {
    const surfaceIndex = surfaces.findIndex((entry) => entry.id === surface.id);
    if (surfaceIndex < 0) return;
    closeSurfaces(surfaces.slice(surfaceIndex + 1));
  });
  const closeAllSurfaces = useStableCallback(() => closeSurfaces(surfaces));
  const closeSurfacesNow = useStableCallback(finishClose);

  return {
    closeSurface,
    closeOtherSurfaces,
    closeSurfacesToRight,
    closeAllSurfaces,
    closeSurfacesNow,
  };
}
