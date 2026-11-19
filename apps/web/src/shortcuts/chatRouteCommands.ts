import { AuthPreviewOperateScope, type EnvironmentId } from "@supaterm/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { isPreviewAvailableFor } from "../browser/previewRuntime";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { useComposerDraftStore } from "../composerDraftStore";
import { dispatchPreviewAction, type PreviewAction } from "../components/preview/previewActionBus";
import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import {
  createNewThreadHandler,
  readRouteThreadContext,
  startNewThreadInCurrentProject,
} from "../hooks/useHandleNewThread";
import { createScratchProjectActions } from "../hooks/useScratchProject";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects } from "../state/entities";
import { environmentPresentations } from "../state/presentation";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { readEnvironmentScope } from "../state/session";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { type CommandHandlers, registerCommands } from "./dispatcher";

const CHAT_ROUTE_ID = "/_chat";

function leavePullRequestsPage(router: AnyRouter) {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) activeElement.blur();
  if (router.state.location.state.__TSR_index !== 0) window.history.back();
  else void router.navigate({ to: "/" });
}

/**
 * New-thread, project picker and preview commands, live while a chat route shows
 * without a modal page over it. Everything is read at event time, so the scope
 * registers once; the route and the focused-pane DOM name the split pane to act on.
 */
export function installChatRouteCommands(router: AnyRouter): () => void {
  const handleNewThread = createNewThreadHandler(router);
  const primaryEnvironmentId = () => appAtomRegistry.get(primaryEnvironmentIdAtom);
  const scratch = createScratchProjectActions({
    environments: () =>
      [...appAtomRegistry.get(environmentPresentations.presentationsAtom)].map(
        ([environmentId, presentation]) => ({ ...presentation, environmentId }),
      ),
    primaryEnvironmentId,
    projects: readProjects,
    registry: appAtomRegistry,
    handleNewThread,
  });

  const readRouteTarget = () => resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const readRouteThreadRef = () => {
    const target = readRouteTarget();
    return target?.kind === "server" ? target.threadRef : null;
  };
  const readRouteEnvironmentId = () => {
    const target = readRouteTarget();
    if (!target) return null;
    return target.kind === "server"
      ? target.threadRef.environmentId
      : (useComposerDraftStore.getState().getDraftSession(target.draftId)?.environmentId ?? null);
  };
  const readPreviewOpen = () => {
    const threadRef = readRouteThreadRef();
    return threadRef
      ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef) === "preview"
      : false;
  };
  const canOperatePreview = (environmentId: EnvironmentId) =>
    readEnvironmentScope(environmentId, AuthPreviewOperateScope);

  const startNewThread = () => {
    void startNewThreadInCurrentProject(router, handleNewThread).then((started) => {
      if (!started) openCommandPalette({ open: "new-thread-in" });
    });
  };

  const previewCommand = (action: PreviewAction) => () => {
    const environmentId = readRouteEnvironmentId();
    if (environmentId && canOperatePreview(environmentId)) dispatchPreviewAction(action);
  };

  const commands: CommandHandlers = {
    "chat.new": startNewThread,
    "chat.newLocal": startNewThread,
    "chat.newWithoutProject": () => {
      const { activeThread, activeDraftThread } = readRouteThreadContext(router);
      const environmentId = scratch.scratchEnvironmentId(
        activeThread?.environmentId ?? activeDraftThread?.environmentId ?? primaryEnvironmentId(),
      );
      if (environmentId === null) return false;
      void scratch.startScratchThread(environmentId);
    },
    "projectPicker.toggle": ({ repeat }) => {
      if (repeat) return;
      const projectTrigger =
        document.querySelector<HTMLButtonElement>(
          '[data-chat-pane][data-focused="true"] [data-draft-project-trigger]',
        ) ?? document.querySelector<HTMLButtonElement>("[data-draft-project-trigger]");
      if (projectTrigger) {
        projectTrigger.focus({ preventScroll: true });
        projectTrigger.click();
      } else {
        openCommandPalette({ open: "new-thread-in" });
      }
    },
    "preview.toggle": () => {
      const threadRef = readRouteThreadRef();
      if (!threadRef || (!canOperatePreview(threadRef.environmentId) && !readPreviewOpen())) {
        return;
      }
      if (!isPreviewAvailableFor(threadRef.environmentId)) {
        toastManager.add(
          stackedThreadToast({
            type: "info",
            title: "Preview is desktop-only",
            description: "Open Supaterm in the desktop app to use the in-app preview.",
          }),
        );
        return;
      }
      dispatchPreviewAction("toggle-panel");
    },
    "preview.refresh": previewCommand("refresh"),
    "preview.focusUrl": previewCommand("focus-url"),
    "preview.zoomIn": previewCommand("zoom-in"),
    "preview.zoomOut": previewCommand("zoom-out"),
    "preview.resetZoom": previewCommand("reset-zoom"),
    "preview.find": previewCommand("find"),
  };

  const when = () =>
    router.state.matches.some((match) => match.routeId === CHAT_ROUTE_ID) &&
    !router.state.matches.some((match) => isAppModalPage(match.pathname)) &&
    !isCommandPaletteOpen();

  return registerCommands(commands, {
    when,
    context: () => {
      const threadRef = readRouteThreadRef();
      return {
        terminalOpen: threadRef
          ? selectThreadTerminalUiState(
              useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
              threadRef,
            ).terminalOpen
          : false,
        previewOpen: readPreviewOpen(),
      };
    },
    onKeyDown: (event) => {
      if (event.key !== "Escape") return false;
      const selection = useThreadSelectionStore.getState();
      if (selection.selectedThreadKeys.size > 0) {
        event.preventDefault();
        selection.clearSelection();
        return;
      }
      if (event.repeat || event.isComposing) return false;
      if (router.state.location.pathname !== "/pull-requests") return false;
      event.preventDefault();
      leavePullRequestsPage(router);
    },
  });
}
