import { installComposerAttachmentUploads } from "./state/composer-attachment-uploads";
import { installThreadOutboxDelivery } from "./state/threadOutboxDelivery";
import {
  disposeOnFoundationReplace,
  type FoundationHotModule,
} from "./lib/foundation-fast-refresh";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform, StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  createStaticNavigation,
  getStateFromPath,
  type NavigationState,
} from "@react-navigation/native";

import { RegistryContext } from "@effect/atom-react";
import { ProjectChipIconRasterizer } from "./native/ProjectChipIconImages";
import { ThreadArrangementHost } from "./features/threads/ThreadArrangementSheet";
import * as Dialog from "./components/ui/Dialog";
import { prepareNativeShowcaseCapture } from "./features/showcase/nativeShowcaseScene";
import { IncomingShareProvider } from "./features/sharing/IncomingShareProvider";
import {
  AppearancePreferencesProvider,
  installAppearanceRuntime,
  useAppearancePreferences,
} from "./features/settings/appearance/AppearancePreferencesProvider";
import { RootStack } from "./Stack";
import { appAtomRegistry } from "./state/atom-registry";
import { subscribeComposerDraftModelReconciliation } from "./state/use-composer-drafts";
import { environmentThreadShells } from "./state/threads";
import { environmentShell } from "./state/shell";
import { OverlayPortalHost } from "./components/ui/OverlayPortal";
import { shouldHandleAppLink, restoreDraftLinkState } from "./lib/appLinking";
import { disarmInlineConfirmsOnTouch } from "./lib/useInlineConfirm";
import { takeScheduledTaskNewLink } from "./features/settings/scheduled-task-editor-state";
import { useMobileNavigationTheme } from "./lib/useMobileNavigationTheme";
import { installUiRuntimeMemoryWarningGc } from "./lib/useUiRuntimeMemoryWarningGc";
import { SubscriptionUsageCoordinator } from "./widgets/SubscriptionUsageCoordinator";
import { installSubscriptionUsageRefresh } from "./widgets/useSubscriptionUsage";
import { GlobalVoiceInputControl } from "./features/voice-input/GlobalVoiceInputControl";
import { NativeLayoutMetricsProvider } from "./native/native-layout-metrics";
import { attachRootNavigation, rootNavigationRef } from "./lib/rootNavigation";
import { pruneNewTaskBranchCheckouts } from "./features/threads/NewTaskDraftRouteScreen";

import "../global.css";

if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {
  prepareNativeShowcaseCapture();
}

void SplashScreen.preventAutoHideAsync().catch(() => {});

const appLinking = {
  prefixes: [Linking.createURL("/"), "supaterm://", "supaterm-dev://", "supaterm-preview://"],
  config: { initialRouteName: "Home" },
  filter: shouldHandleAppLink,
  getStateFromPath: (path: string, options: Parameters<typeof getStateFromPath>[1]) =>
    takeScheduledTaskNewLink(restoreDraftLinkState(getStateFromPath(path, options), path)),
};

const Navigation = createStaticNavigation(RootStack);

function handleNavigationStateChange(state: NavigationState | undefined): void {
  if (state) pruneNewTaskBranchCheckouts(state);
}

function handleNavigationReady(): void {
  handleNavigationStateChange(rootNavigationRef.getRootState());
}

declare const module: { readonly hot?: FoundationHotModule } | undefined;

const appServiceDisposers = [
  installUiRuntimeMemoryWarningGc(),
  subscribeComposerDraftModelReconciliation({
    registry: appAtomRegistry,
    threadShellAtom: environmentThreadShells.threadShellAtom,
    threadRefsAtom: environmentThreadShells.threadRefsAtom,
    shellStateAtom: environmentShell.stateAtom,
  }),
  installAppearanceRuntime(),
  installSubscriptionUsageRefresh(),
  installThreadOutboxDelivery(),
  installComposerAttachmentUploads(),
];
disposeOnFoundationReplace(typeof module === "undefined" ? undefined : module.hot, () => {
  for (const dispose of appServiceDisposers) dispose();
});

function SplashScreenCoordinator() {
  const { isReady } = useAppearancePreferences();

  useEffect(() => {
    if (isReady) void SplashScreen.hide();
  }, [isReady]);

  return null;
}

export default function App() {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <AppearancePreferencesProvider>
        <AppContent />
      </AppearancePreferencesProvider>
    </RegistryContext.Provider>
  );
}

function AppContent() {
  const { themeAppearance } = useAppearancePreferences();
  const navigationTheme = useMobileNavigationTheme();

  return (
    <>
      <SplashScreenCoordinator />
      <SubscriptionUsageCoordinator />
      <GestureHandlerRootView className="flex-1" onTouchStart={disarmInlineConfirmsOnTouch}>
        <KeyboardProvider statusBarTranslucent>
          <SafeAreaProvider>
            {Platform.OS === "android" ? (
              <StatusBar barStyle={themeAppearance === "dark" ? "light-content" : "dark-content"} />
            ) : null}
            {/* native-stack forwards the navigation theme's `dark` as the nav bar's
                overrideUserInterfaceStyle; without it every native header is forced light
                even in system dark mode. */}
            <GlobalVoiceInputControl>
              <NativeLayoutMetricsProvider>
                <IncomingShareProvider>
                  <Navigation
                    ref={attachRootNavigation}
                    linking={appLinking}
                    onReady={handleNavigationReady}
                    theme={navigationTheme}
                    onStateChange={handleNavigationStateChange}
                  />
                </IncomingShareProvider>
                <Dialog.Host />
                <ThreadArrangementHost />
                <ProjectChipIconRasterizer />
              </NativeLayoutMetricsProvider>
            </GlobalVoiceInputControl>
            {/* Anchored-menu overlays render here — in-window, so the
                keyboard stays up while a dropdown is open. */}
            <OverlayPortalHost />
          </SafeAreaProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </>
  );
}
