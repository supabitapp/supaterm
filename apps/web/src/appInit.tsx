import { startDesktopUpdateLaunchNotice } from "./components/sidebar/updateEverythingRun";
import { startThreadNotifications } from "./components/ThreadNotificationCoordinator";
import { startPullRequestGuideRunNotifications } from "./components/pullRequest/guide/PullRequestGuideRunCoordinator";
import { installCommandPaletteCommands } from "./shortcuts/commandPaletteCommands";
import { startWorkspaceFocus } from "./lib/workspaceFocus";
import { installChatRouteCommands } from "./shortcuts/chatRouteCommands";
import type { ClientSettings } from "@supaterm/contracts/settings";
import { createBrowserHistory, createHashHistory } from "@tanstack/react-router";

import { startElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { startPreviewTitleRecording } from "./browserHistoryStore";
import { startBrowserProfileReporting } from "./browser/BrowserProfileReporter";
import { startAgentOpenedPreviews } from "./components/preview/agentOpenedPreviews";
import { startSshPasswordPromptQueue } from "./components/desktop/SshPasswordPromptDialog";
import { startHostFreezeToasts } from "./components/HostFreezeToastCoordinator";
import { startKeybindingsUpdateToasts } from "./components/KeybindingsUpdateToast";
import { startSlowRpcRequestToasts } from "./components/SlowRpcRequestToastCoordinator";
import { applyAppearanceContrast } from "./appearanceContrast";
import { applyAppearanceFontVariables } from "./appearanceFonts";
import { APP_DISPLAY_NAME } from "./branding";
import {
  subscribeDraftThreadPromotion,
  subscribeComposerDraftModelReconciliation,
} from "./composerDraftStore";
import { isElectron } from "./env";
import { startDefaultThemeAdoption } from "./hooks/useDefaultTheme";
import { startEnvironmentThemeRepaint } from "./hooks/useEnvironmentTheme";
import { getClientSettings, subscribeClientSettings } from "./hooks/useSettings";
import { startThemeSync, syncBrowserChromeTheme } from "./hooks/useTheme";
import { installDesktopPasteAsText } from "./lib/desktopPasteAsText";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { startProviderAuthDelivery } from "./providerAuthDelivery";
import { getRouter, type AppRouter } from "./router";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { environmentShell } from "./state/shell";
import { environmentThreadShells } from "./state/threads";

function startClientAppearance(): () => void {
  const root = document.documentElement;
  let applied: ClientSettings | null = null;
  const apply = () => {
    const settings = getClientSettings();
    const previous = applied;
    applied = settings;
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
      if (settings.glassOpacity === 100) root.style.setProperty("--glass-blur", "0px");
      else root.style.removeProperty("--glass-blur");
    }
    if (
      previous?.fontFamilySans !== settings.fontFamilySans ||
      previous.fontFamilyCode !== settings.fontFamilyCode ||
      previous.fontFamilyComposer !== settings.fontFamilyComposer ||
      previous.fontSizeInterface !== settings.fontSizeInterface ||
      previous.fontSizePrompt !== settings.fontSizePrompt ||
      previous.fontSizeCode !== settings.fontSizeCode ||
      previous.fontSmoothing !== settings.fontSmoothing
    ) {
      applyAppearanceFontVariables(root, {
        sans: settings.fontFamilySans,
        code: settings.fontFamilyCode,
        composer: settings.fontFamilyComposer,
        sizeInterface: settings.fontSizeInterface,
        sizePrompt: settings.fontSizePrompt,
        sizeCode: settings.fontSizeCode,
        smoothing: settings.fontSmoothing,
      });
    }
  };
  const stop = subscribeClientSettings(apply);
  apply();
  return stop;
}

let router: AppRouter | null = null;
const disposers: Array<() => void> = [];

export function startAppServices(): AppRouter {
  if (router) return router;
  if (window.location.pathname === "/guest") {
    throw new Error("The guest page has no owner app services.");
  }
  startProviderAuthDelivery();
  router = getRouter(isElectron ? createHashHistory() : createBrowserHistory());
  if (isElectron) {
    syncDocumentElectronPlatformClasses(navigator.platform);
    syncDocumentWindowControlsOverlayClass();
    disposers.push(startElectronBrowserHost(), startDesktopUpdateLaunchNotice());
  }
  disposers.push(
    startHostFreezeToasts(),
    startKeybindingsUpdateToasts(),
    startSlowRpcRequestToasts(),
  );
  disposers.push(startBrowserProfileReporting());
  disposers.push(startPreviewTitleRecording(), startAgentOpenedPreviews());
  disposers.push(
    installChatRouteCommands(router),
    installCommandPaletteCommands(router),
    startWorkspaceFocus(router),
  );
  disposers.push(
    subscribeDraftThreadPromotion({
      registry: appAtomRegistry,
      threadRefsAtom: environmentThreadShells.threadRefsAtom,
      threadShellAtom: environmentThreadShells.threadShellAtom,
    }),
  );
  disposers.push(
    startPullRequestGuideRunNotifications(router, appAtomRegistry),
    startThreadNotifications(appAtomRegistry, router),
  );
  document.title = APP_DISPLAY_NAME;
  disposers.push(startSshPasswordPromptQueue());
  disposers.push(startClientAppearance(), startThemeSync());
  disposers.push(startEnvironmentThemeRepaint(), startDefaultThemeAdoption());
  const stopDesktopPaste = installDesktopPasteAsText(window.desktopBridge, window);
  if (stopDesktopPaste) disposers.push(stopDesktopPaste);
  disposers.push(
    subscribeComposerDraftModelReconciliation({
      registry: appAtomRegistry,
      threadShellAtom: environmentThreadShells.threadShellAtom,
      threadRefsAtom: environmentThreadShells.threadRefsAtom,
      shellStateAtom: environmentShell.stateAtom,
    }),
  );
  let frame: number | null = null;
  const syncChrome = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      frame = null;
      syncBrowserChromeTheme();
    });
  };
  disposers.push(router.subscribe("onRendered", syncChrome));
  disposers.push(router.subscribe("onResolved", syncChrome));
  disposers.push(() => {
    if (frame !== null) window.cancelAnimationFrame(frame);
  });
  return router;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const dispose of disposers.splice(0).toReversed()) dispose();
    router = null;
  });
}
