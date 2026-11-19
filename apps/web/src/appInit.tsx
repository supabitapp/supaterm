import { scopedThreadKey, scopeProjectRef } from "@supaterm/client-runtime/environment";
import type { ScopedThreadRef } from "@supaterm/contracts";
import type { ClientSettings } from "@supaterm/contracts/settings";
import { createBrowserHistory, createHashHistory } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { applyAppearanceContrast } from "./appearanceContrast";
import { applyAppearanceFontVariables, TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "./appearanceFonts";
import { startElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { startThreadOverlayRetention } from "./components/chat/threadOverlayRetention";
import { startBrowserProfileReporting } from "./browser/BrowserProfileReporter";
import { startPreviewTitleRecording } from "./browserHistoryStore";
import { resolveWindowTitleThreadStatus } from "./components/Sidebar.logic";
import { startBackgroundThreadAnnouncements } from "./components/BackgroundThreadAnnouncer";
import { startSshPasswordPromptQueue } from "./components/desktop/SshPasswordPromptDialog";
import { startHostFreezeToasts } from "./components/HostFreezeToastCoordinator";
import { startKeybindingsUpdateToasts } from "./components/KeybindingsUpdateToast";
import { startAgentOpenedPreviews } from "./components/preview/agentOpenedPreviews";
import { startMainAppLocationTracking } from "./components/sidebar/mainAppLocation";
import { startDesktopUpdateLaunchNotice } from "./components/sidebar/updateEverythingRun";
import { startSlowRpcRequestToasts } from "./components/SlowRpcRequestToastCoordinator";
import { startThreadNotifications } from "./components/ThreadNotificationCoordinator";
import { startGuideRunNotifications } from "./components/pullRequest/guide/PullRequestGuideRunCoordinator";
import { APP_DISPLAY_NAME, resolveWindowTitle } from "./branding";
import { isElectron } from "./env";
import {
  subscribeComposerDraftModelReconciliation,
  subscribeDraftThreadPromotion,
  useComposerDraftStore,
} from "./composerDraftStore";
import { startDefaultThemeAdoption } from "./hooks/useDefaultTheme";
import { startEnvironmentThemeRepaint } from "./hooks/useEnvironmentTheme";
import { readLocalStorageValue, subscribeLocalStorageKey } from "./hooks/useLocalStorage";
import { startHostEnvironmentLookup } from "./state/primaryEnvironment";
import { getClientSettings, subscribeClientSettings } from "./hooks/useSettings";
import { syncBrowserChromeTheme } from "./hooks/useTheme";
import { installDesktopPasteAsText } from "./lib/desktopPasteAsText";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { startProviderAuthDelivery } from "./providerAuthDelivery";
import { getRouter, type AppRouter } from "./router";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { environmentProjects } from "./state/projects";
import { environmentShell } from "./state/shell";
import { startWorkspaceFocus } from "./lib/workspaceFocus";
import { installChatRouteCommands } from "./shortcuts/chatRouteCommands";
import { installCommandPaletteCommands } from "./shortcuts/commandPaletteCommands";
import { registerOpenFavoriteEditorCommand } from "./components/chat/OpenInPickerShortcut";
import { environmentThreadShells, threadEnvironment } from "./state/threads";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "./threadRoutes";

function startClientAppearance(): void {
  const root = document.documentElement;
  let applied: ClientSettings | null = null;
  let appliedSeparateFonts: boolean | null = null;
  const apply = () => {
    const settings = getClientSettings();
    const previous = applied;
    applied = settings;
    const separateFonts = readLocalStorageValue(
      TYPOGRAPHY_ADVANCED_STORAGE_KEY,
      false,
      Schema.Boolean,
    );
    const previousSeparateFonts = appliedSeparateFonts;
    appliedSeparateFonts = separateFonts;
    if (previous?.diffColorScheme !== settings.diffColorScheme) {
      root.dataset.diffColorScheme = settings.diffColorScheme;
    }
    if (previous?.chatWidth !== settings.chatWidth) {
      root.dataset.chatWidth = settings.chatWidth;
    }
    if (previous?.appearanceContrast !== settings.appearanceContrast) {
      applyAppearanceContrast(root, settings.appearanceContrast);
    }
    if (previous?.glassOpacity !== settings.glassOpacity) {
      root.style.setProperty("--glass-opacity", `${settings.glassOpacity}%`);
      if (settings.glassOpacity === 100) {
        root.style.setProperty("--glass-blur", "0px");
      } else {
        root.style.removeProperty("--glass-blur");
      }
    }
    if (
      previous?.fontFamilySans !== settings.fontFamilySans ||
      previous.fontFamilyCode !== settings.fontFamilyCode ||
      previous.fontFamilyComposer !== settings.fontFamilyComposer ||
      previous.fontSizeInterface !== settings.fontSizeInterface ||
      previous.fontSizePrompt !== settings.fontSizePrompt ||
      previous.fontSizeCode !== settings.fontSizeCode ||
      previous.fontSmoothing !== settings.fontSmoothing ||
      previousSeparateFonts !== separateFonts
    ) {
      applyAppearanceFontVariables(root, {
        sans: settings.fontFamilySans,
        code: settings.fontFamilyCode,
        composer: settings.fontFamilyComposer,
        sizeInterface: settings.fontSizeInterface,
        sizePrompt: settings.fontSizePrompt,
        sizeCode: settings.fontSizeCode,
        smoothing: settings.fontSmoothing,
        separate: separateFonts,
      });
    }
  };
  subscribeClientSettings(apply);
  subscribeLocalStorageKey(TYPOGRAPHY_ADVANCED_STORAGE_KEY, apply);
  apply();
}

function readOpenThreadRef(router: AppRouter): ScopedThreadRef | null {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const draft =
    target?.kind === "draft"
      ? useComposerDraftStore.getState().getDraftSession(target.draftId)
      : null;
  return resolveActiveThreadRouteRef(target, draft);
}

function startDocumentTitle(router: AppRouter): void {
  let openThreadRef = readOpenThreadRef(router);
  const write = () => {
    const thread =
      openThreadRef === null
        ? null
        : appAtomRegistry.get(environmentThreadShells.quietThreadShellAtom(openThreadRef));
    const project =
      thread === null
        ? null
        : appAtomRegistry.get(
            environmentProjects.projectAtom(
              scopeProjectRef(thread.environmentId, thread.projectId),
            ),
          );
    const title = resolveWindowTitle({
      appDisplayName: APP_DISPLAY_NAME,
      projectTitle: project?.title ?? null,
      threadTitle: thread?.title ?? null,
      ...(getClientSettings().screenReaderWindowTitle && {
        screenReader: {
          threadStatus: thread === null ? null : resolveWindowTitleThreadStatus(thread),
        },
      }),
      desktop: isElectron,
    });
    if (document.title !== title) document.title = title;
  };
  let unsubscribeOpenThread = () => {};
  const watchOpenThread = () => {
    unsubscribeOpenThread();
    unsubscribeOpenThread =
      openThreadRef === null
        ? () => {}
        : appAtomRegistry.subscribe(
            environmentThreadShells.quietThreadShellAtom(openThreadRef),
            write,
          );
  };
  const updateOpenThread = () => {
    const next = readOpenThreadRef(router);
    if ((next && scopedThreadKey(next)) === (openThreadRef && scopedThreadKey(openThreadRef))) {
      return;
    }
    openThreadRef = next;
    watchOpenThread();
    write();
  };
  watchOpenThread();
  write();
  appAtomRegistry.subscribe(environmentProjects.projectsAtom, write);
  subscribeClientSettings(write);
  router.subscribe("onResolved", updateOpenThread);
  useComposerDraftStore.subscribe(updateOpenThread);
}

function startBrowserChromeThemeSync(router: AppRouter): void {
  const resync = () => window.requestAnimationFrame(syncBrowserChromeTheme);
  router.subscribe("onRendered", resync);
  router.subscribe("onResolved", resync);
}

/**
 * Starts every app-lifetime service once, before the first render, and returns the router.
 * They run for the life of the page, so their disposers are dropped here.
 */
export function startAppServices(): AppRouter {
  startProviderAuthDelivery();

  const router = getRouter(isElectron ? createHashHistory() : createBrowserHistory());

  if (isElectron) {
    syncDocumentElectronPlatformClasses(navigator.platform);
    syncDocumentWindowControlsOverlayClass();
  }

  installDesktopPasteAsText(window.desktopBridge, window);

  startClientAppearance();
  startDocumentTitle(router);
  startHostEnvironmentLookup();
  startEnvironmentThemeRepaint();
  startBrowserChromeThemeSync(router);
  startDefaultThemeAdoption();
  startAgentOpenedPreviews();
  if (isElectron) startElectronBrowserHost();
  startPreviewTitleRecording();
  startBrowserProfileReporting();
  installCommandPaletteCommands(router);
  installChatRouteCommands(router);
  registerOpenFavoriteEditorCommand();
  startThreadOverlayRetention(router);
  subscribeDraftThreadPromotion({
    registry: appAtomRegistry,
    threadShellAtom: environmentThreadShells.quietThreadShellAtom,
    threadRefsAtom: environmentThreadShells.threadRefsAtom,
  });
  subscribeComposerDraftModelReconciliation({
    registry: appAtomRegistry,
    threadShellAtom: environmentThreadShells.threadShellAtom,
    threadRefsAtom: environmentThreadShells.threadRefsAtom,
    shellStateAtom: environmentShell.stateAtom,
    pendingThreadIdsAtom: threadEnvironment.pendingThreadIdsAtom,
  });
  startMainAppLocationTracking(router);
  startWorkspaceFocus(router);
  startBackgroundThreadAnnouncements(appAtomRegistry, router);
  startSshPasswordPromptQueue();

  startKeybindingsUpdateToasts();
  startSlowRpcRequestToasts();
  startHostFreezeToasts();
  startThreadNotifications(appAtomRegistry, router);
  startGuideRunNotifications(appAtomRegistry, router);
  if (isElectron) startDesktopUpdateLaunchNotice();

  return router;
}
