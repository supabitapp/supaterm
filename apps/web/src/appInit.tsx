import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { ClientSettings } from "@supaterm/contracts/settings";
import { createBrowserHistory, createHashHistory } from "@tanstack/react-router";

import { applyAppearanceContrast } from "./appearanceContrast";
import { applyAppearanceFontVariables } from "./appearanceFonts";
import { useChatPaneStore } from "./chatPanes/store";
import { retainThreadOverlaysFor } from "./components/chat/threadOverlayRetention";
import { startAgentOpenedPreviews } from "./components/preview/agentOpenedPreviews";
import { APP_DISPLAY_NAME } from "./branding";
import { isElectron } from "./env";
import { useComposerDraftStore } from "./composerDraftStore";
import { getClientSettings, subscribeClientSettings } from "./hooks/useSettings";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { prepareProviderAuthDelivery } from "./providerAuthDelivery";
import { getRouter, type AppRouter } from "./router";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "./threadRoutes";

/** Writes appearance settings onto the document, touching only the groups that changed. */
function startClientAppearance(): void {
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
  subscribeClientSettings(apply);
  apply();
}

/** The thread a route or pane shows, as the key its chat overlays were opened under. */
function shownThreadKey(target: ThreadRouteTarget | null): string | null {
  if (target?.kind === "server") return scopedThreadKey(target.threadRef);
  const draftSession =
    target?.kind === "draft"
      ? useComposerDraftStore.getState().getDraftSession(target.draftId)
      : null;
  return draftSession
    ? scopedThreadKey(scopeThreadRef(draftSession.environmentId, draftSession.threadId))
    : null;
}

/** Chat overlays belong to the thread they were opened in, so a thread no route or pane shows drops them. */
function startThreadOverlayRetention(router: AppRouter): void {
  const retain = () => {
    const shown = new Set<string>();
    const routeKey = shownThreadKey(
      resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {}),
    );
    if (routeKey !== null) shown.add(routeKey);
    for (const cell of useChatPaneStore.getState().layout?.cells ?? []) {
      const paneKey = shownThreadKey(cell.target);
      if (paneKey !== null) shown.add(paneKey);
    }
    retainThreadOverlaysFor(shown);
  };
  router.subscribe("onResolved", retain);
  useChatPaneStore.subscribe(retain);
}

/**
 * Starts every app-lifetime service once, before the first render, and returns the router.
 * They run for the life of the page, so their disposers are dropped here.
 */
export function startAppServices(): AppRouter {
  // Ahead of the history: the provider auth code must leave the address before anything reads it.
  prepareProviderAuthDelivery();

  // Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
  const router = getRouter(isElectron ? createHashHistory() : createBrowserHistory());

  if (isElectron) {
    syncDocumentElectronPlatformClasses(navigator.platform);
    syncDocumentWindowControlsOverlayClass();
  }

  startClientAppearance();
  document.title = APP_DISPLAY_NAME;
  startAgentOpenedPreviews();
  startThreadOverlayRetention(router);

  return router;
}
