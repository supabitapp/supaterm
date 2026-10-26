import { useAtomValue } from "@effect/atom-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { KeybindingCommand } from "@supaterm/contracts";

import { registerAppCommandHandler } from "../appCommandBus";
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
import { useEnvironmentIdentificationMode } from "../hooks/useSettings";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import ThreadSidebar from "./Sidebar";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { SidebarBrandWidthProbe, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { MainAppLocationTracker } from "./sidebar/mainAppLocation";
import type { SidebarRouteReveal } from "./sidebar/routeReveal";
import { useSidebarStageBackdrop } from "./SidebarStageBackdrop";
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
  const isSidebarVisible = useSidebarVisibility();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const showStageBackdrop = useSidebarStageBackdrop(environmentIdentificationMode === "artwork");
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle", {
    context: { usagePageOpen },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (
        isRichTextBoldShortcut(event) &&
        event.target instanceof HTMLElement &&
        event.target.closest('[data-composer-rich-text="true"]')
      ) {
        // The rich-text composer claims Mod+B for bold; the toggle stays
        // available everywhere else, including the plain-text composer.
        return;
      }
      if (
        resolveShortcutCommand(event, keybindings, { context: { usagePageOpen } }) !==
        "sidebar.toggle"
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    window.addEventListener("keydown", onKeyDown, true);

    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      if (action === "sidebar.toggle") toggleSidebar();
    });
    const unregister = registerAppCommandHandler((command) => {
      if (command !== "sidebar.toggle") return false;
      toggleSidebar();
      return true;
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe?.();
      unregister();
    };
  }, [keybindings, toggleSidebar, usagePageOpen]);

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
            <SidebarTrigger
              variant={isSidebarVisible && showStageBackdrop ? "media-navigation" : "ghost"}
              className={cn(
                "pointer-events-auto",
                isSidebarVisible && showStageBackdrop && "relative top-auto translate-y-0",
              )}
              aria-label="Toggle main sidebar"
            />
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

function navigateHistory(command: KeybindingCommand | null): boolean {
  switch (command) {
    case "navigation.back":
      window.history.back();
      return true;
    case "navigation.forward":
      window.history.forward();
      return true;
    default:
      return false;
  }
}

export function NavigationHistoryShortcuts() {
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const routeThreadRef = useThreadRouteRef();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          previewFocus: isPreviewFocused(),
          ...routePanelsOpen(routeThreadRef),
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
          usagePageOpen,
        },
      });
      if (!navigateHistory(command)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown);
    const unregister = registerAppCommandHandler(navigateHistory);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unregister();
    };
  }, [keybindings, routeThreadRef, usagePageOpen]);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
    };
    // Pastes from a menu, dictation and drops edit text without a keypress.
    const onInput = () => releaseThreadUndoShortcut();

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("input", onInput, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("input", onInput, true);
    };
  }, [keybindings, noticeVisible, routeThreadRef]);

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
  const navigate = useNavigate();
  const [sidebarRouteReveal] = useState<SidebarRouteReveal>(() => ({
    observedKey: null,
    pendingKey: null,
  }));
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const pathname = useLocation({ select: (location) => location.pathname });
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;
  const isOnSettings = pathname === "/settings" || pathname.startsWith("/settings/");
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

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

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
          role="navigation"
          aria-label={isOnSettings ? "Settings" : "Threads"}
          resizable={{
            defaultWidth: resolveDefaultThreadSidebarWidth(window.innerWidth),
            minWidth: sidebarMinimumWidth,
            storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
          }}
          style={windowControlsInsetStyle}
        >
          {isOnSettings ? (
            <>
              <SidebarChromeHeader isElectron={isElectron} />
              <SettingsSidebarNav pathname={pathname} />
            </>
          ) : (
            <ThreadSidebar routeReveal={sidebarRouteReveal} />
          )}
        </Sidebar>
        <SidebarInsetPanel minWidth={THREAD_MAIN_CONTENT_MIN_WIDTH}>
          <SidebarBrandWidthProbe onWidthChange={setBrandWidth} />
          <ProjectProjectionRetention />
          {children}
          <SidebarControl />
          <NavigationHistoryShortcuts />
          {isOnSettings ? null : <ThreadUndoShortcut />}
          <MainAppLocationTracker />
        </SidebarInsetPanel>
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
