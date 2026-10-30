import { workspaceAreaProps } from "../lib/workspaceFocus";
import type { AnyRouter } from "@tanstack/react-router";
import { registerCommands, registerMenuAction } from "../shortcuts/dispatcher";
import { useStableCallback } from "../hooks/useStableCallback";
import { useAtomValue } from "@effect/atom-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useRouter } from "@tanstack/react-router";

import { isAppRouteModalOpen } from "./AppRouteModal";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { isElectron } from "../env";
import {
  releaseThreadUndoShortcut,
  threadUndoClaimsShortcut,
  undoLatestThreadAction,
} from "../hooks/showThreadUndoNotice";
import {
  isRichTextBoldShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { cn, isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import { BackgroundThreadAnnouncer } from "./BackgroundThreadAnnouncer";
import ThreadSidebar from "./Sidebar";
import { SidebarBrandWidthProbe } from "./sidebar/SidebarChrome";
import { MainAppLocationTracker } from "./sidebar/mainAppLocation";
import type { SidebarRouteReveal } from "./sidebar/routeReveal";
import { useProjects } from "../state/entities";
import {
  resolveDefaultThreadSidebarWidth,
  resolveThreadSidebarMinimumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import {
  Sidebar,
  SidebarInsetPanel,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
  useSidebarVisibility,
} from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";

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

function SidebarControl() {
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar, isMobile, mobileSheetMounted } = useSidebar();
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle", {
    context: { usagePageOpen },
  });

  const toggle = useStableCallback(() => toggleSidebar());
  const available = useStableCallback(
    (event: KeyboardEvent) =>
      !isAppRouteModalOpen() &&
      !(event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]")) &&
      !(
        isRichTextBoldShortcut(event, window.getSelection()) &&
        event.target instanceof HTMLElement &&
        event.target.closest('[data-composer-rich-text="true"]')
      ),
  );
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- registers sidebar keyboard and native menu actions while its control is mounted
  useEffect(() => {
    const stopCommands = registerCommands(
      {
        "sidebar.toggle": (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggle();
        },
      },
      { capture: true, when: available },
    );
    const stopMenu = registerMenuAction("sidebar.toggle", toggle);
    return () => {
      stopCommands();
      stopMenu();
    };
  }, [available, toggle]);

  return (
    <div
      className={cn(
        "pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center",
        isMobile && mobileSheetMounted && "hidden",
      )}
      data-sidebar-control=""
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger className="pointer-events-auto" aria-label="Toggle main sidebar" />
          }
        />
        <TooltipPopup side="bottom" shortcut={shortcutLabel}>
          Toggle main sidebar
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function routePanelsOpen(routeThreadRef: ReturnType<typeof useThreadRouteRef>) {
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
      "navigation.back": (event) => {
        event.preventDefault();
        event.stopPropagation();
        router.history.back();
      },
      "navigation.forward": (event) => {
        event.preventDefault();
        event.stopPropagation();
        router.history.forward();
      },
    },
    {
      when: () => !isAppRouteModalOpen(),
      context: () => ({ usagePageOpen: router.state.location.pathname === "/usage" }),
    },
  );
}

function NavigationHistoryShortcuts() {
  const router = useRouter();
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- keeps route history commands installed while the shell is mounted
  useEffect(() => registerNavigationHistoryCommands(router), [router]);
  return null;
}

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

// Undoes the thread actions in the sidebar's notice. Mounted wherever the
// thread sidebar can show; Settings replaces it. Listens in the capture phase
// so mod+z reaches it before the composer's own undo handler consumes the key.
function ThreadUndoShortcut() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const routeThreadRef = useThreadRouteRef();
  // A collapsed sidebar hides the notice, so text fields keep their own undo.
  const noticeVisible = useSidebarVisibility();
  // Outlives the effect: undoing an archive navigates, which re-runs it mid-hold.
  const heldUndoKey = useRef<string | null>(null);

  const onKeyDown = useStableCallback((event: KeyboardEvent) => {
    if (isAppRouteModalOpen()) return;
    // A held key undoes once. Cancel its repeats so they cannot fall through
    // to the editor's own undo, even after the last notice is gone.
    if (event.repeat) {
      if (event.code === heldUndoKey.current) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    // A modifier tapped mid-hold leaves the held key repeating.
    if (!MODIFIER_KEYS.has(event.key)) heldUndoKey.current = null;
    const command = resolveShortcutCommand(event, keybindings, {
      context: {
        terminalFocus: isTerminalFocused(),
        previewFocus: isPreviewFocused(),
        ...routePanelsOpen(routeThreadRef),
        editableFocus:
          isEditableFocused(event.target) && !(noticeVisible && threadUndoClaimsShortcut()),
        modelPickerOpen: isModelPickerOpen(),
      },
    });
    if (command !== "thread.undo") {
      if (!MODIFIER_KEYS.has(event.key)) releaseThreadUndoShortcut();
      return;
    }
    if (isCommandPaletteOpen() || isModelPickerOpen()) return;
    if (undoLatestThreadAction()) {
      heldUndoKey.current = event.code;
      event.preventDefault();
      event.stopPropagation();
    }
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- owns held-undo keyboard and input listeners while the sidebar notice can show
  useEffect(() => {
    // Pastes from a menu, dictation and drops edit text without a keypress.
    const onInput = () => releaseThreadUndoShortcut();

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("input", onInput, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("input", onInput, true);
    };
  }, [onKeyDown]);

  return null;
}

// Settings swaps the thread sidebar out of the tree. Keep the lightweight
// project projection subscribed so returning to a draft never renders the
// zero-project state while the environment snapshot reconnects.
function ProjectProjectionRetention() {
  useProjects();
  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
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
  const [brandWidth, setBrandWidth] = useState(0);
  const sidebarMinimumWidth = resolveThreadSidebarMinimumWidth(brandWidth);
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

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- registers the native settings menu for the mounted application router
  useEffect(
    () =>
      registerMenuAction("open-settings", () => {
        if (!/^\/settings(\/|$)/.test(router.state.location.pathname)) {
          void router.navigate({ to: "/settings" });
        }
      }),
    [router],
  );

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
          {...workspaceAreaProps("sidebar", 0, "Threads")}
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
        <BackgroundThreadAnnouncer />
        <SidebarInsetPanel minWidth={THREAD_MAIN_CONTENT_MIN_WIDTH}>
          <SidebarBrandWidthProbe onWidthChange={setBrandWidth} />
          <ProjectProjectionRetention />
          {children}
          <SidebarControl />
          <NavigationHistoryShortcuts />
          <ThreadUndoShortcut />
          <MainAppLocationTracker />
        </SidebarInsetPanel>
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
