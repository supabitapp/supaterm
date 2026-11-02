import { useSyncExternalStore } from "react";
import { Appearance, Keyboard, View } from "react-native";
import {
  CommonActions,
  type NavigationAction,
  type NavigationState,
  type PartialState,
  StackActions,
} from "@react-navigation/native";
import { runAtomCommand } from "@supaterm/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { requireOptionalNativeModule } from "expo";

import { connectPairingUrl } from "../../connection/onboarding";
import {
  normalizeMobileThemeMode,
  resolveMobileThemeIds,
  type MobileThemeId,
} from "../../lib/mobileTheme";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { environmentProjects } from "../../state/projects";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { environmentThreads, environmentThreadShells } from "../../state/threads";
import { holdEditingQueuedMessage } from "../../state/use-thread-outbox";
import { workspaceConnections } from "../../state/workspace";
import { resolveThemeAppearance } from "../settings/appearance/AppearancePreferencesProvider";
import {
  applyNativeShowcaseOrientation,
  getNativeShowcaseOrientation,
  getNativeShowcasePairingUrls,
  getNativeShowcaseScene,
  getNativeShowcaseTheme,
  markNativeShowcaseReady,
  type ShowcaseScene,
} from "./nativeShowcaseScene";
import {
  isShowcaseThemeApplied,
  SHOWCASE_THREAD_ID,
  showcaseReadinessKey,
  showcaseSceneOnScreen,
  showcaseThemePatch,
  shouldNavigateToShowcaseScene,
  type ShowcaseNavigationTarget,
} from "./showcaseCaptureModel";
import {
  buildShowcasePendingTasks,
  SHOWCASE_PENDING_TASK_DEFINITIONS,
} from "./showcasePendingTasks";
import {
  clearShowcaseRenderSignal,
  getShowcaseRenderSnapshot,
  subscribeToShowcaseRenderSignal,
} from "./showcaseRenderSignal";
import { retryShowcaseOperation } from "./showcaseRetry";

const SHOWCASE_ENABLED = process.env.EXPO_PUBLIC_SHOWCASE === "1";
// Native launch requests (pairing links, scene switches) have no change event.
const NATIVE_POLL_MS = 250;
const READY_SETTLE_MS = 500;
type ShowcaseResetRoute = PartialState<NavigationState>["routes"][number];

const readySceneListeners = new Set<() => void>();
let readyScene: ShowcaseScene | null = null;

function setReadyScene(scene: ShowcaseScene | null): void {
  if (readyScene === scene) return;
  readyScene = scene;
  for (const listener of readySceneListeners) listener();
}

function subscribeToReadyScene(listener: () => void): () => void {
  readySceneListeners.add(listener);
  return () => readySceneListeners.delete(listener);
}

function getReadyScene(): ShowcaseScene | null {
  return readyScene;
}

function showcaseNavigationAction(scene: ShowcaseScene, environmentId: string): NavigationAction {
  if (scene === "threads") return StackActions.popToTop();
  const params = { environmentId, threadId: SHOWCASE_THREAD_ID };
  const routes: ShowcaseResetRoute[] = [{ name: "Home" }];
  if (scene === "environments") {
    routes.push({ name: "Settings" }, { name: "SettingsEnvironments" });
  } else {
    routes.push({ name: "Thread", params });
    if (scene === "terminal") {
      routes.push({ name: "ThreadTerminal", params: { ...params, terminalId: "term-1" } });
    } else if (scene === "review") {
      routes.push({ name: "ThreadReview", params });
    }
  }
  return CommonActions.reset({ index: routes.length - 1, routes });
}

/**
 * Drives a showcase capture: pairs servers, seeds the fixture, applies theme and
 * orientation, and navigates to each scene the native harness requests. Inputs
 * are read from their stores on each step, so nothing depends on render timing.
 */
export function installShowcaseCapture(
  pathnameFromState: (state: NavigationState) => string,
): () => void {
  if (!SHOWCASE_ENABLED) return () => {};

  let disposed = false;
  let launchRequestRead = false;
  let requestedTheme: MobileThemeId | null = null;
  let requestedScene: ShowcaseScene | null = null;
  let pendingTasks: "unseeded" | "seeding" | "seeded" = "unseeded";
  let lastNavigation: ShowcaseNavigationTarget | null = null;
  let readiness: { key: string; cancel: () => void } | null = null;
  const isCancelled = () => disposed;

  const devMenu = requireOptionalNativeModule<{
    closeMenu(): void;
    setToolsButtonVisible(visible: boolean): void;
  }>("ExpoDevMenu");
  // The dev menu can open after bundle loading and block orientation requests.
  const devMenuTimer = setInterval(() => {
    devMenu?.closeMenu();
    devMenu?.setToolsButtonVisible(false);
  }, 1_000);

  const orientation = getNativeShowcaseOrientation();
  let orientationSettled = orientation === null;
  if (orientation !== null) {
    void retryShowcaseOperation(async () => applyNativeShowcaseOrientation(orientation), {
      isCancelled,
    }).then((applied) => {
      if (!applied) return;
      orientationSettled = true;
      evaluate();
    });
  }

  const pair = (pairingUrls: ReadonlyArray<string>) => {
    for (const pairingUrl of pairingUrls) {
      void retryShowcaseOperation(
        async () =>
          AsyncResult.isSuccess(
            await runAtomCommand(
              appAtomRegistry,
              connectPairingUrl,
              { pairingUrl },
              { reportFailure: false },
            ),
          ),
        { isCancelled },
      );
    }
  };

  const readNativeRequests = () => {
    if (!launchRequestRead) {
      const pairingUrls = getNativeShowcasePairingUrls();
      if (pairingUrls.length > 0) {
        launchRequestRead = true;
        requestedTheme = getNativeShowcaseTheme();
        pair(pairingUrls);
      }
    }
    const scene = getNativeShowcaseScene();
    if (scene && scene !== requestedScene) {
      requestedScene = scene;
      // A native draw belongs only to the scene request that produced it. In
      // particular, revisiting review must wait for its newly mounted surface.
      clearShowcaseRenderSignal();
    }
  };

  const seedPendingTasks = () => {
    const tasks = buildShowcasePendingTasks(
      appAtomRegistry.get(environmentProjects.projectsAtom),
      Date.now(),
    );
    if (tasks.length !== SHOWCASE_PENDING_TASK_DEFINITIONS.length) return;
    pendingTasks = "seeding";
    for (const task of tasks) holdEditingQueuedMessage(task.messageId);
    void Promise.all(
      tasks.map((task) =>
        retryShowcaseOperation(
          async () => {
            await enqueueThreadOutboxMessage(task);
            return true;
          },
          { isCancelled },
        ),
      ),
    ).then((results) => {
      if (!results.every(Boolean)) return;
      pendingTasks = "seeded";
      evaluate();
    });
  };

  const updateReadiness = (key: string | null, scene: ShowcaseScene | null) => {
    if (readiness?.key === key) return;
    readiness?.cancel();
    readiness = null;
    if (key === null || scene === null) {
      setReadyScene(null);
      return;
    }
    if (scene === "terminal") Keyboard.dismiss();
    let frame: number | null = null;
    // Two frames after the settle delay so the scene has been drawn, not just committed.
    const settleTimer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = null;
          markNativeShowcaseReady(scene);
          setReadyScene(scene);
        });
      });
    }, READY_SETTLE_MS);
    readiness = {
      key,
      cancel: () => {
        clearTimeout(settleTimer);
        if (frame !== null) cancelAnimationFrame(frame);
      },
    };
  };

  const step = () => {
    readNativeRequests();

    const preferences = appAtomRegistry.get(mobilePreferencesAtom);
    const storedPreferences = AsyncResult.isSuccess(preferences) ? preferences.value : null;
    const themeMode = normalizeMobileThemeMode(storedPreferences?.themeMode);
    const themeIds = resolveMobileThemeIds(storedPreferences ?? {});
    const themeId = themeIds[resolveThemeAppearance(storedPreferences)];
    const themeApplied = isShowcaseThemeApplied({
      preferencesReady: storedPreferences !== null,
      launchRequestRead,
      requestedTheme,
      themeMode,
      themeId,
    });
    // The write patches preferences optimistically, so the step it triggers sees
    // it. A failed save rolls the patch back, and the next step writes again.
    const themePatch =
      launchRequestRead && storedPreferences
        ? showcaseThemePatch({ themeMode, themeIds, requestedTheme })
        : null;
    if (themePatch) appAtomRegistry.set(updateMobilePreferencesAtom, themePatch);

    const projects = appAtomRegistry.get(environmentProjects.projectsAtom);
    const threads = appAtomRegistry.get(environmentThreadShells.threadShellsAtom);
    const showcaseThread = threads.find((thread) => String(thread.id) === SHOWCASE_THREAD_ID);
    const hasServerFixture =
      appAtomRegistry.get(workspaceConnections.stateAtom).hasReadyEnvironment &&
      appAtomRegistry.get(workspaceConnections.environmentsAtom).length >= 3 &&
      projects.length >= 3 &&
      showcaseThread !== undefined;
    if (hasServerFixture && pendingTasks === "unseeded") seedPendingTasks();
    const hasFixture = hasServerFixture && pendingTasks === "seeded";

    const rootState = rootNavigationRef.isReady() ? rootNavigationRef.getRootState() : undefined;
    const scene = rootState ? showcaseSceneOnScreen(pathnameFromState(rootState)) : null;

    if (requestedScene !== null && hasFixture && showcaseThread && rootState) {
      const navigation = { requestedScene, scene, thread: showcaseThread };
      // Arriving forgets the target, so leaving the scene again navigates back.
      if (scene === requestedScene) {
        lastNavigation = null;
      } else if (shouldNavigateToShowcaseScene(lastNavigation, navigation)) {
        lastNavigation = navigation;
        rootNavigationRef.dispatch({
          ...showcaseNavigationAction(requestedScene, String(showcaseThread.environmentId)),
          target: rootState.key,
        });
      }
    }

    // Read only while the thread screen keeps the thread mounted.
    const threadState =
      scene === "thread" && showcaseThread
        ? appAtomRegistry.get(
            environmentThreads.stateAtom(showcaseThread.environmentId, showcaseThread.id),
          )
        : null;
    const threadSynced =
      threadState !== null &&
      AsyncResult.isSuccess(threadState) &&
      threadState.value.status === "live";
    const render = getShowcaseRenderSnapshot();
    updateReadiness(
      showcaseReadinessKey({
        scene,
        requestedScene,
        hasFixture,
        threadSynced,
        orientationSettled,
        themeApplied,
        themeId,
        renderSignal: render.signal,
        renderReports: render.reports,
      }),
      scene,
    );
  };

  // Steps write atoms they also observe; a nested change reruns the step once
  // the current one finishes instead of interleaving with it.
  let stepping = false;
  let stepAgain = false;
  function evaluate() {
    if (disposed) return;
    if (stepping) {
      stepAgain = true;
      return;
    }
    stepping = true;
    try {
      do {
        stepAgain = false;
        step();
      } while (stepAgain);
    } finally {
      stepping = false;
    }
  }

  const unsubscribers = [
    appAtomRegistry.subscribe(mobilePreferencesAtom, evaluate),
    appAtomRegistry.subscribe(environmentProjects.projectsAtom, evaluate),
    appAtomRegistry.subscribe(environmentThreadShells.threadShellsAtom, evaluate),
    appAtomRegistry.subscribe(workspaceConnections.stateAtom, evaluate),
    appAtomRegistry.subscribe(workspaceConnections.environmentsAtom, evaluate),
    subscribeToShowcaseRenderSignal(evaluate),
    rootNavigationRef.addListener("state", evaluate),
  ];
  const appearanceSubscription = Appearance.addChangeListener(evaluate);
  const pollTimer = setInterval(evaluate, NATIVE_POLL_MS);
  evaluate();

  return () => {
    disposed = true;
    clearInterval(devMenuTimer);
    clearInterval(pollTimer);
    appearanceSubscription.remove();
    for (const unsubscribe of unsubscribers) unsubscribe();
    readiness?.cancel();
    readiness = null;
    setReadyScene(null);
  };
}

/** The capture harness waits for this marker before taking a screenshot. */
export function ShowcaseReadyMarker() {
  const scene = useSyncExternalStore(subscribeToReadyScene, getReadyScene, getReadyScene);
  if (scene === null) return null;
  return (
    <View
      pointerEvents="none"
      testID={`showcase-ready-${scene}`}
      style={{ position: "absolute", width: 1, height: 1, opacity: 0.01 }}
    />
  );
}
