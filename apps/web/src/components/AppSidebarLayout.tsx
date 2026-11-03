import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useRouter, type AnyRouter } from "@tanstack/react-router";

import { moveWorkspaceFocus, workspaceAreaProps } from "../lib/workspaceFocus";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { isElectron } from "../env";
import {
  releaseThreadUndoShortcut,
  threadUndoClaimsShortcut,
  undoLatestThreadAction,
} from "../hooks/showThreadUndoNotice";
import { isRichTextBoldShortcut } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { cn, isMacPlatform } from "../lib/utils";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import { BackgroundThreadAnnouncer } from "./BackgroundThreadAnnouncer";
import { HistorySwipeNavigation } from "./HistorySwipeNavigation";
import { navigateHistory } from "../navigationHistory";
import ThreadSidebar from "./Sidebar";
import { MainSidebarToggle, SidebarHeaderWidthProbe } from "./sidebar/SidebarChrome";
import { isAppModalPage } from "./sidebar/mainAppLocation";
import type { SidebarRouteReveal } from "./sidebar/routeReveal";
import {
  resolveDefaultThreadSidebarWidth,
  resolveThreadSidebarMinimumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import { Sidebar, SidebarInsetPanel, SidebarProvider, useSidebar } from "./ui/sidebar";
import { type CommandHandler, registerCommands, registerMenuAction } from "../shortcuts/dispatcher";
import { resolveThreadRouteRef } from "../threadRoutes";

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "var(--desktop-window-controls-inset, 90px)";

let windowFullscreenSnapshot: boolean | null = null;

function isMacosDesktopWindow(): boolean {
  return isElectron && isMacPlatform(navigator.platform);
}

function subscribeToWindowFullscreen(onChange: () => void): () => void {
  const bridge = window.desktopBridge;
  if (!isMacosDesktopWindow() || !bridge) return () => {};
  const { getWindowFullscreenState, onWindowFullscreenStateChange } = bridge;
  if (
    typeof getWindowFullscreenState !== "function" ||
    typeof onWindowFullscreenStateChange !== "function"
  ) {
    return () => {};
  }
  const unsubscribe = onWindowFullscreenStateChange((fullscreen) => {
    windowFullscreenSnapshot = fullscreen;
    onChange();
  });
  windowFullscreenSnapshot = getWindowFullscreenState();
  onChange();
  return unsubscribe;
}

function readWindowFullscreen(): boolean {
  if (windowFullscreenSnapshot === null) {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    windowFullscreenSnapshot =
      isMacosDesktopWindow() && typeof getWindowFullscreenState === "function"
        ? getWindowFullscreenState()
        : false;
  }
  return windowFullscreenSnapshot;
}

function readUsagePageOpen(router: AnyRouter) {
  return router.state.location.pathname === "/usage";
}

function readRoutePanelsOpen(router: AnyRouter) {
  const routeThreadRef = resolveThreadRouteRef(router.state.matches.at(-1)?.params ?? {});
  if (!routeThreadRef) return { terminalOpen: false, previewOpen: false };
  return {
    terminalOpen: selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      routeThreadRef,
    ).terminalOpen,
    previewOpen:
      selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, routeThreadRef) ===
      "preview",
  };
}

export function registerNavigationHistoryCommands(router: AnyRouter): () => void {
  return registerCommands(
    {
      "navigation.back": () => navigateHistory("back"),
      "navigation.forward": () => navigateHistory("forward"),
    },
    {
      context: () => ({
        ...readRoutePanelsOpen(router),
        usagePageOpen: readUsagePageOpen(router),
      }),
    },
  );
}

// Capture phase, so F6 also leaves widgets that swallow keys, such as the terminal.
function registerWorkspaceFocusCommands(router: AnyRouter): () => void {
  // Inside a dialog the move is refused, but the key is still consumed. A focused
  // desktop browser forwards the keys as menu actions; its renderer focus is stale.
  const move =
    (direction: 1 | -1): CommandHandler =>
    ({ source, event }) => {
      if (event?.isComposing) return false;
      moveWorkspaceFocus(direction, source === "menu" ? "panel" : undefined);
    };
  return registerCommands(
    { "workspace.focusNext": move(1), "workspace.focusPrevious": move(-1) },
    { capture: true, context: () => readRoutePanelsOpen(router) },
  );
}

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

// A held key undoes once. Module state: undoing an archive navigates, and the
// hold must survive whatever that re-renders.
let heldUndoKey: string | null = null;

// Undoes the thread actions in the sidebar's notice. Settings and Usage own
// mod+z while open. Captured so mod+z reaches it before the composer's own
// undo handler consumes the key.
function registerThreadUndoCommands(
  router: AnyRouter,
  readSidebarVisible: () => boolean,
): () => void {
  const threadSidebarShown = () => !isAppModalPage(router.state.location.pathname);
  // Registered first, so it hears only keys the undo command left: any other
  // keypress hands mod+z back to text fields. A modifier tapped mid-hold leaves
  // the held key repeating.
  const unregisterRelease = registerCommands(
    {},
    {
      capture: true,
      when: threadSidebarShown,
      onKeyDown: (event) => {
        if (event.repeat || MODIFIER_KEYS.has(event.key)) return false;
        heldUndoKey = null;
        releaseThreadUndoShortcut();
        return false;
      },
    },
  );
  const unregisterUndo = registerCommands(
    {
      "thread.undo": ({ event, repeat }) => {
        if (repeat || isCommandPaletteOpen() || isModelPickerOpen()) return false;
        if (!undoLatestThreadAction()) return false;
        heldUndoKey = event?.code ?? null;
      },
    },
    {
      capture: true,
      when: threadSidebarShown,
      context: (event) => ({
        ...readRoutePanelsOpen(router),
        // A collapsed sidebar hides the notice, so text fields keep their own undo.
        editableFocus:
          isEditableFocused(event.target) && !(readSidebarVisible() && threadUndoClaimsShortcut()),
      }),
      // Cancel a held key's repeats so they cannot fall through to the
      // editor's own undo, even after the last notice is gone.
      onKeyDown: (event) => {
        if (!event.repeat || event.code !== heldUndoKey) return false;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  );
  // Pastes from a menu, dictation and drops edit text without a keypress.
  const onInput = () => {
    if (threadSidebarShown()) releaseThreadUndoShortcut();
  };
  window.addEventListener("input", onInput, true);
  return () => {
    unregisterUndo();
    unregisterRelease();
    window.removeEventListener("input", onInput, true);
  };
}

function registerSidebarToggleCommand(router: AnyRouter, toggleSidebar: () => void): () => void {
  return registerCommands(
    {
      "sidebar.toggle": ({ event }) => {
        // The rich-text composer claims Mod+B only to bold selected text;
        // the toggle stays available everywhere else.
        if (
          event &&
          isRichTextBoldShortcut(event, window.getSelection()) &&
          event.target instanceof HTMLElement &&
          event.target.closest('[data-composer-rich-text="true"]')
        ) {
          return false;
        }
        toggleSidebar();
      },
    },
    { capture: true, context: () => ({ usagePageOpen: readUsagePageOpen(router) }) },
  );
}

/** Keyboard and menu commands that live as long as the app shell. */
function registerAppShellCommands(router: AnyRouter, shellElement: Element): () => void {
  // The provider mirrors the visibility it renders onto its wrapper, so the
  // committed state is readable when a key arrives.
  const readSidebarVisible = () =>
    shellElement.closest('[data-slot="sidebar-wrapper"]')?.getAttribute("data-sidebar-state") ===
    "expanded";
  const disposers = [
    registerThreadUndoCommands(router, readSidebarVisible),
    registerNavigationHistoryCommands(router),
    registerWorkspaceFocusCommands(router),
    registerMenuAction("open-settings", () => {
      if (!/^\/settings(\/|$)/.test(router.state.location.pathname))
        void router.navigate({ to: "/settings" });
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

function SidebarControl() {
  const router = useRouter();
  const { toggleSidebar, isMobile, mobileSheetMounted } = useSidebar();

  const toggleSidebarFromCommand = useEffectEvent(() => toggleSidebar());
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- registers the sidebar toggle with the command dispatcher for the control's lifetime
  useEffect(() => registerSidebarToggleCommand(router, () => toggleSidebarFromCommand()), [router]);

  // The control lives as long as the shell, so it carries the shell's commands. Created
  // once so re-renders never re-register them.
  const [appShellCommandsRef] = useState(
    () => (node: HTMLDivElement | null) =>
      node === null ? undefined : registerAppShellCommands(router, node),
  );

  return (
    <div
      ref={appShellCommandsRef}
      className={cn(
        "pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center",
        isMobile && mobileSheetMounted && "hidden",
      )}
      data-sidebar-control=""
    >
      <MainSidebarToggle className="pointer-events-auto" />
    </div>
  );
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const sidebarArea = workspaceAreaProps("sidebar", 0, "Threads");
  const [sidebarRouteReveal] = useState<SidebarRouteReveal>(() => ({
    observedKey: null,
    pendingKey: null,
  }));
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const pathname = useLocation({ select: (location) => location.pathname });
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;
  const isMacosDesktop = isMacosDesktopWindow();
  const [headerWidth, setHeaderWidth] = useState(0);
  const sidebarMinimumWidth = resolveThreadSidebarMinimumWidth(headerWidth);
  const isWindowFullscreen = useSyncExternalStore(
    subscribeToWindowFullscreen,
    readWindowFullscreen,
  );
  const windowControlsInsetStyle = (
    isMacosDesktop && !isWindowFullscreen
      ? { "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET }
      : {}
  ) as CSSProperties;
  const sidebarProviderStyle = {
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
    ...windowControlsInsetStyle,
  } as CSSProperties;

  return (
    <PanelAnimationSuppressionProvider value={panelAnimationsSuppressed}>
      <SidebarProvider
        className="h-dvh! min-h-0!"
        data-panel-animations={routePanelAnimationsActive ? "true" : "false"}
        defaultOpen
        style={sidebarProviderStyle}
      >
        <Sidebar
          side="left"
          data-app-sidebar=""
          {...sidebarArea}
          role="navigation"
          aria-label="Threads"
          resizable={{
            defaultWidth: resolveDefaultThreadSidebarWidth(window.innerWidth),
            minWidth: sidebarMinimumWidth,
            storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
          }}
          style={windowControlsInsetStyle}
        >
          <ThreadSidebar routeReveal={sidebarRouteReveal} />
        </Sidebar>
        <SidebarInsetPanel minWidth={THREAD_MAIN_CONTENT_MIN_WIDTH}>
          <SidebarHeaderWidthProbe onWidthChange={setHeaderWidth} />
          {children}
          <BackgroundThreadAnnouncer />
          <SidebarControl />
          {isElectron ? <HistorySwipeNavigation /> : null}
        </SidebarInsetPanel>
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
