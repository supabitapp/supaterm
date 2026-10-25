import { AuthPreviewOperateScope, type KeybindingCommand } from "@supaterm/contracts";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { registerAppCommandHandler } from "../appCommandBus";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { ChatPaneWorkspace } from "../components/chatPanes/ChatPaneWorkspace";
import { ThreadLinkPrompt } from "../components/promptLinks/ThreadLinkPrompt";
import { isPreviewAvailableFor } from "../browser/previewRuntime";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { dispatchPreviewAction } from "../components/preview/previewActionBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isEditableFocused } from "../lib/editableFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";

function previewActionForCommand(command: KeybindingCommand | null) {
  switch (command) {
    case "preview.refresh":
      return "refresh";
    case "preview.focusUrl":
      return "focus-url";
    case "preview.zoomIn":
      return "zoom-in";
    case "preview.zoomOut":
      return "zoom-out";
    case "preview.resetZoom":
      return "reset-zoom";
    default:
      return null;
  }
}

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const canOperatePreview = useEnvironmentScope(
    routeThreadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const terminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  // This flag is store-only; dispatch the action bus to reuse ChatView's URL-aware arbitration.
  const previewOpen = useRightPanelStore((state) =>
    routeThreadRef
      ? selectActiveRightPanel(state.byThreadKey, routeThreadRef) === "preview"
      : false,
  );
  useEffect(() => {
    const runCommand = (command: KeybindingCommand | null, repeat: boolean): boolean => {
      if (command === "chat.new" || command === "chat.newLocal") {
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return true;
      }

      if (command === "chat.newWithoutProject") {
        const environmentId = scratchEnvironmentId(
          activeThread?.environmentId ?? activeDraftThread?.environmentId ?? primaryEnvironmentId,
        );
        if (environmentId === null) return false;
        void startScratchThread(environmentId);
        return true;
      }

      if (command === "projectPicker.toggle") {
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

      if (command === "preview.toggle") {
        if (!routeThreadRef || (!canOperatePreview && !previewOpen)) return true;
        if (!isPreviewAvailableFor(routeThreadRef.environmentId)) {
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

      const previewAction = previewActionForCommand(command);
      if (previewAction === null) return false;
      if (canOperatePreview) dispatchPreviewAction(previewAction);
      return true;
    };

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });

      if (isCommandPaletteOpen()) {
        return;
      }

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (!runCommand(command, event.repeat)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onWindowKeyDown);
    const unregister = registerAppCommandHandler(
      (command) => !isCommandPaletteOpen() && runCommand(command, false),
    );
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      unregister();
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    canOperatePreview,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    previewOpen,
    primaryEnvironmentId,
    routeThreadRef,
    scratchEnvironmentId,
    selectedThreadKeysSize,
    startScratchThread,
    terminalOpen,
  ]);

  return null;
}

function ChatRouteLayout() {
  // Render both routes here so draft promotion keeps the same ChatView mounted.
  const threadTarget = useThreadRouteTarget();
  return (
    <>
      <ChatRouteGlobalShortcuts />
      {threadTarget?.kind === "server" ? (
        <ThreadLinkPrompt threadRef={threadTarget.threadRef} />
      ) : null}
      {threadTarget ? <ChatPaneWorkspace target={threadTarget} /> : <Outlet />}
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
