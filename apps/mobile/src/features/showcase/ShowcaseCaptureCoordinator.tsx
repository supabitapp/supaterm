import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Keyboard, View } from "react-native";
import {
  CommonActions,
  type NavigationState,
  type PartialState,
  StackActions,
  useNavigation,
} from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { requireOptionalNativeModule } from "expo";

import { useConnectionController } from "../connection/useConnectionController";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import type { MobileThemeId } from "../../lib/mobileTheme";
import { useProjects, useThreadShells } from "../../state/entities";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { holdEditingQueuedMessage } from "../../state/use-thread-outbox";
import { useWorkspaceState } from "../../state/workspace";
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
  buildShowcasePendingTasks,
  SHOWCASE_PENDING_TASK_DEFINITIONS,
} from "./showcasePendingTasks";
import {
  isShowcaseThemeApplied,
  SHOWCASE_THREAD_ID,
  showcaseReadinessKey,
  showcaseSceneOnScreen,
} from "./showcaseCaptureModel";
import { retryShowcaseOperation } from "./showcaseRetry";
import {
  clearShowcaseRenderSignal,
  getShowcaseRenderSnapshot,
  subscribeToShowcaseRenderSignal,
} from "./showcaseRenderSignal";

const SHOWCASE_ENABLED = process.env.EXPO_PUBLIC_SHOWCASE === "1";
type ShowcaseResetRoute = PartialState<NavigationState>["routes"][number];

export function ShowcaseCaptureCoordinator(props: { readonly pathname: string }) {
  if (!SHOWCASE_ENABLED) return null;
  return <EnabledShowcaseCaptureCoordinator pathname={props.pathname} />;
}

function EnabledShowcaseCaptureCoordinator(props: { readonly pathname: string }) {
  const navigation = useNavigation();
  useEffect(() => {
    const menu = requireOptionalNativeModule<{
      closeMenu(): void;
      setToolsButtonVisible(visible: boolean): void;
    }>("ExpoDevMenu");
    // The dev menu can open after bundle loading and block orientation requests.
    const timer = setInterval(() => {
      menu?.closeMenu();
      menu?.setToolsButtonVisible(false);
    }, 1_000);
    return () => clearInterval(timer);
  }, []);
  const { connectPairingUrl } = useConnectionController();
  const {
    isReady: appearancePreferencesReady,
    themeId,
    themeMode,
    setThemeIdForBothAppearances,
    setThemeMode,
  } = useAppearancePreferences();
  const workspace = useWorkspaceState();
  const projects = useProjects();
  const threads = useThreadShells();
  const attemptedPairingRef = useRef(new Set<string>());
  const seededPendingTaskIdsRef = useRef(new Set<string>());
  const [pairingUrls, setPairingUrls] = useState<ReadonlyArray<string>>([]);
  const [pendingTasksReady, setPendingTasksReady] = useState(false);
  const [requestedScene, setRequestedScene] = useState<ShowcaseScene | null>(null);
  const [requestedTheme, setRequestedTheme] = useState<MobileThemeId | null>(null);
  const [themeRequestSettled, setThemeRequestSettled] = useState(false);
  const [readyScene, setReadyScene] = useState<ShowcaseScene | null>(null);
  const [captureOrientation] = useState(() =>
    SHOWCASE_ENABLED ? getNativeShowcaseOrientation() : null,
  );
  const [orientationSettled, setOrientationSettled] = useState(captureOrientation === null);
  const requestedSceneRef = useRef<ShowcaseScene | null>(null);
  const { signal: renderSignal, reports: renderReports } = useSyncExternalStore(
    subscribeToShowcaseRenderSignal,
    getShowcaseRenderSnapshot,
    getShowcaseRenderSnapshot,
  );

  useEffect(() => {
    if (pairingUrls.length > 0) return;

    const readLaunchRequest = () => {
      const values = getNativeShowcasePairingUrls();
      if (values.length === 0) return;
      setRequestedTheme(getNativeShowcaseTheme());
      setThemeRequestSettled(true);
      setPairingUrls(values);
    };
    readLaunchRequest();
    const interval = setInterval(readLaunchRequest, 250);
    return () => clearInterval(interval);
  }, [pairingUrls.length]);

  useEffect(() => {
    if (!SHOWCASE_ENABLED || orientationSettled || captureOrientation === null) return;

    let cancelled = false;
    void retryShowcaseOperation(async () => applyNativeShowcaseOrientation(captureOrientation), {
      isCancelled: () => cancelled,
    }).then((applied) => {
      if (!cancelled && applied) setOrientationSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [captureOrientation, orientationSettled]);

  useEffect(() => {
    const readRequestedScene = () => {
      const value = getNativeShowcaseScene();
      if (!value || requestedSceneRef.current === value) return;
      requestedSceneRef.current = value;
      // A native draw belongs only to the scene request that produced it. In
      // particular, revisiting review must wait for its newly mounted surface.
      clearShowcaseRenderSignal();
      setRequestedScene(value);
    };
    readRequestedScene();
    const interval = setInterval(readRequestedScene, 250);
    return () => clearInterval(interval);
  }, []);

  const themeApplied = isShowcaseThemeApplied({
    preferencesReady: appearancePreferencesReady,
    launchRequestRead: themeRequestSettled,
    requestedTheme,
    themeMode,
    themeId,
  });

  useEffect(() => {
    if (!themeRequestSettled || themeApplied || !appearancePreferencesReady) {
      return;
    }
    if (themeMode !== "system") {
      setThemeMode("system");
      return;
    }
    if (requestedTheme !== null) setThemeIdForBothAppearances(requestedTheme);
  }, [
    appearancePreferencesReady,
    requestedTheme,
    setThemeIdForBothAppearances,
    setThemeMode,
    themeApplied,
    themeMode,
    themeRequestSettled,
  ]);

  useEffect(() => {
    if (pairingUrls.length === 0) return;
    let cancelled = false;
    void (async () => {
      await Promise.all(
        pairingUrls.map(async (pairingUrl) => {
          if (cancelled || attemptedPairingRef.current.has(pairingUrl)) return;
          const paired = await retryShowcaseOperation(
            async () => AsyncResult.isSuccess(await connectPairingUrl(pairingUrl)),
            { isCancelled: () => cancelled },
          );
          if (paired) attemptedPairingRef.current.add(pairingUrl);
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [connectPairingUrl, pairingUrls]);

  const scene = showcaseSceneOnScreen(props.pathname);
  const hasServerFixture =
    workspace.state.hasReadyEnvironment &&
    workspace.environments.length >= 3 &&
    projects.length >= 3 &&
    threads.some((thread) => String(thread.id) === SHOWCASE_THREAD_ID);
  const hasFixture = hasServerFixture && pendingTasksReady;
  const showcaseThread = threads.find((thread) => String(thread.id) === SHOWCASE_THREAD_ID);

  useEffect(() => {
    if (!hasServerFixture || pendingTasksReady) return;

    const pendingTasks = buildShowcasePendingTasks(projects, Date.now());
    if (pendingTasks.length !== SHOWCASE_PENDING_TASK_DEFINITIONS.length) return;

    let cancelled = false;
    for (const task of pendingTasks) holdEditingQueuedMessage(task.messageId);
    void (async () => {
      const results = await Promise.all(
        pendingTasks.map(async (task) => {
          const messageId = String(task.messageId);
          if (seededPendingTaskIdsRef.current.has(messageId)) return true;
          const seeded = await retryShowcaseOperation(
            async () => {
              await enqueueThreadOutboxMessage(task);
              return true;
            },
            { isCancelled: () => cancelled },
          );
          if (seeded) seededPendingTaskIdsRef.current.add(messageId);
          return seeded;
        }),
      );
      if (!cancelled && results.every(Boolean)) setPendingTasksReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasServerFixture, pendingTasksReady, projects]);

  useEffect(() => {
    if (requestedScene === null || !hasFixture || !showcaseThread) return;
    if (scene === requestedScene) return;

    const params = {
      environmentId: String(showcaseThread.environmentId),
      threadId: SHOWCASE_THREAD_ID,
    };
    if (requestedScene === "threads") {
      navigation.dispatch(StackActions.popToTop());
      return;
    }
    const routes: ShowcaseResetRoute[] = [{ name: "Home" }];
    if (requestedScene === "environments") {
      routes.push({
        name: "SettingsSheet",
        state: {
          index: 0,
          routes: [
            {
              name: "SettingsContent",
              state: {
                index: 1,
                routes: [{ name: "Settings" }, { name: "SettingsEnvironments" }],
              },
            },
          ],
        },
      });
    } else {
      routes.push({ name: "Thread", params });
      if (requestedScene === "terminal") {
        routes.push({
          name: "ThreadTerminal",
          params: { ...params, terminalId: "term-1" },
        });
      } else if (requestedScene === "review") {
        routes.push({ name: "ThreadReview", params });
      }
    }
    navigation.dispatch(
      CommonActions.reset({
        index: routes.length - 1,
        routes,
      }),
    );
  }, [hasFixture, navigation, requestedScene, scene, showcaseThread]);

  const readinessKey = showcaseReadinessKey({
    scene,
    requestedScene,
    hasFixture,
    orientationSettled,
    themeApplied,
    themeId,
    renderSignal,
    renderReports,
  });
  // Losing readiness hides the marker. A redraw or theme change while ready keeps it and re-settles.
  if (readinessKey === null && readyScene !== null) setReadyScene(null);

  useEffect(() => {
    const target = readinessKey === null ? null : scene;
    if (target === null) return;
    if (target === "terminal") Keyboard.dismiss();

    let renderFrame: number | null = null;
    let readyFrame: number | null = null;
    const settleTimer = setTimeout(() => {
      renderFrame = requestAnimationFrame(() => {
        readyFrame = requestAnimationFrame(() => {
          markNativeShowcaseReady(target);
          setReadyScene(target);
        });
      });
    }, 500);
    return () => {
      clearTimeout(settleTimer);
      if (renderFrame !== null) cancelAnimationFrame(renderFrame);
      if (readyFrame !== null) cancelAnimationFrame(readyFrame);
    };
  }, [readinessKey, scene]);

  if (readyScene === null) return null;

  return (
    <View
      pointerEvents="none"
      testID={`showcase-ready-${readyScene}`}
      style={{ position: "absolute", width: 1, height: 1, opacity: 0.01 }}
    />
  );
}
