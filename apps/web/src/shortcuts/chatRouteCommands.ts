import { AuthPreviewOperateScope, type KeybindingCommand } from "@supaterm/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { registerAppCommandHandler } from "../appCommandBus";
import { isPreviewAvailableFor } from "../browser/previewRuntime";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
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

const CHAT_ROUTE_COMMANDS = [
  "chat.new",
  "chat.newLocal",
  "chat.newWithoutProject",
  "projectPicker.toggle",
  "preview.toggle",
  "preview.refresh",
  "preview.focusUrl",
  "preview.zoomIn",
  "preview.zoomOut",
  "preview.resetZoom",
] as const satisfies ReadonlyArray<KeybindingCommand>;

const PREVIEW_ACTION_BY_COMMAND: Partial<Record<KeybindingCommand, PreviewAction>> = {
  "preview.refresh": "refresh",
  "preview.focusUrl": "focus-url",
  "preview.zoomIn": "zoom-in",
  "preview.zoomOut": "zoom-out",
  "preview.resetZoom": "reset-zoom",
};

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

  const readRouteThreadRef = () => {
    const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
    return target?.kind === "server" ? target.threadRef : null;
  };
  const readPreviewOpen = () => {
    const threadRef = readRouteThreadRef();
    // Store-only on purpose: the URL-aware arbitration lives in ChatView's
    // preview toggle, which the action bus reaches.
    return threadRef
      ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef) === "preview"
      : false;
  };
  const canOperatePreview = () => {
    const threadRef = readRouteThreadRef();
    return (
      threadRef !== null && readEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope)
    );
  };

  /** Returns false when the command is not one of these, or cannot run right now. */
  const runCommand = (command: KeybindingCommand, repeat: boolean): boolean => {
    switch (command) {
      case "chat.new":
      case "chat.newLocal":
        void startNewThreadInCurrentProject(router, handleNewThread);
        return true;
      case "chat.newWithoutProject": {
        const { activeThread, activeDraftThread } = readRouteThreadContext(router);
        const environmentId = scratch.scratchEnvironmentId(
          activeThread?.environmentId ?? activeDraftThread?.environmentId ?? primaryEnvironmentId(),
        );
        if (environmentId === null) return false;
        void scratch.startScratchThread(environmentId);
        return true;
      }
      case "projectPicker.toggle": {
        if (repeat) return true;
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
        return true;
      }
      case "preview.toggle": {
        const threadRef = readRouteThreadRef();
        if (!threadRef || (!canOperatePreview() && !readPreviewOpen())) return true;
        if (!isPreviewAvailableFor(threadRef.environmentId)) {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Preview is desktop-only",
              description: "Open Supaterm in the desktop app to use the in-app preview.",
            }),
          );
          return true;
        }
        dispatchPreviewAction("toggle-panel");
        return true;
      }
      default: {
        const previewAction = PREVIEW_ACTION_BY_COMMAND[command];
        if (previewAction === undefined) return false;
        if (canOperatePreview()) dispatchPreviewAction(previewAction);
        return true;
      }
    }
  };

  const isLive = () =>
    router.state.matches.some((match) => match.routeId === CHAT_ROUTE_ID) &&
    !router.state.matches.some((match) => isAppModalPage(match.pathname)) &&
    !isCommandPaletteOpen();

  const commands: CommandHandlers = Object.fromEntries(
    CHAT_ROUTE_COMMANDS.map((command) => [
      command,
      (event: KeyboardEvent) => {
        if (!runCommand(command, event.repeat)) return false;
        event.preventDefault();
        event.stopPropagation();
      },
    ]),
  );
  const disposeCommands = registerCommands(commands, {
    when: isLive,
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
      if (selection.selectedThreadKeys.size === 0) return false;
      event.preventDefault();
      selection.clearSelection();
    },
  });
  // Commands that arrive without a key press, such as from a connected device.
  const disposeAppCommands = registerAppCommandHandler(
    (command) => isLive() && runCommand(command, false),
  );
  return () => {
    disposeCommands();
    disposeAppCommands();
  };
}
