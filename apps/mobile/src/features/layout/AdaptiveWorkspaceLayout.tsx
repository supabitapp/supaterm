import {
  WorkspaceColumnsRendererContext,
  WorkspacePresentationHostContext,
} from "./workspace-presentation-context";
import { useAndroidFloatingTabs } from "../settings/appearance/AppearancePreferencesProvider";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AdaptiveWorkspaceContext,
  WorkspacePaneStateContext,
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
  type AdaptiveWorkspaceActions,
} from "./adaptive-workspace-context";
import { threadSelectionDeferral } from "./deferred-navigation";
import { uuidv4 } from "../../lib/uuid";
import type { SidebarProjectGroupingMode } from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { NavigationContext, NavigationRouteContext, useNavigation } from "@react-navigation/native";
import {
  use,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { AsyncResult } from "effect/reactivity";

import {
  deriveFileInspectorPaneLayout,
  alignListPaneToHinge,
  deriveLayout,
  type VerticalHinge,
  deriveWorkspacePaneLayout,
  isPrimarySidebarPinned,
  isWorkspaceListPath,
  nativeInspectorColumnWidth,
} from "../../lib/layout";
import type { ThreadListFilters } from "../../persistence/mobile-preferences";
import { withKnownPullRequestSummary } from "../../state/use-thread-pr";
import { mobilePreferencesAtom } from "../../state/preferences";
import {
  DEFAULT_MOBILE_PROJECT_GROUPING_SETTINGS,
  resolveMobileProjectGroupingSettings,
} from "../../state/project-grouping";
import {
  parseActiveThreadPath,
  useHardwareKeyboardCommand,
} from "../keyboard/hardwareKeyboardCommands";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { useEnabledNavigationTabs } from "./workspace/navigation-tabs";
import { FLOATING_TABS, floatingTabsMetrics } from "./workspace/floating-workspace-tabs";
import {
  AndroidWorkspaceNavigation,
  FloatingWorkspaceTabs,
  ANDROID_WORKSPACE_RAIL_WIDTH,
} from "./workspace/AndroidWorkspaceNavigation";
import {
  selectWorkspaceDetail,
  type WorkspaceDetail,
  type WorkspaceDetailSheet,
} from "./workspace/workspace-detail-selection";
import { startOpeningDetail } from "./workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "./workspace/WorkspaceTabsContext";
import { HomeListOptionsProvider } from "../home/home-list-options";
import { readStartNewTaskDestination } from "../threads/use-start-new-task";
import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import { PaneContext } from "../../components/ui/Pane";
import { WORKSPACE_PANE_TIMING } from "./workspace-pane-animation";
import { WorkspaceInspectorPane } from "./workspace-inspector-pane";
import { WorkspaceInspectorSheet } from "./workspace-inspector-sheet";
import type { InspectorContent } from "./inspector-panes";
import {
  WorkspaceContentWidthContext,
  WorkspaceSettledContentWidthContext,
} from "./workspace-content-width";
import {
  NativeWorkspaceModeContext,
  NativeWorkspaceInspectorContext,
} from "../../native/v5-workspace-context";

import { useNativeLayoutMetrics } from "../../native/native-layout-metrics";
import { AndroidHingeObserver } from "../../native/AndroidHingeObserver";
import { WindowHingeContext } from "../../native/window-hinge-context";
import { useAndroidWorkspaceRoot } from "./workspace/AndroidWorkspaceTabsProvider";
import { dispatchRootStackReset, rootStackState } from "../../lib/root-stack-reset";
import {
  currentWorkspaceSelections,
  workspaceSelectionCheck,
} from "./workspace/workspace-selection-store";
import {
  workspaceTabColumns,
  workspaceTabNavigationState,
} from "./workspace/workspace-tab-navigation";
import { workspaceTabOf, type WorkspaceTab } from "./workspace/workspace-tabs-state";
import { workspaceRoutesOf } from "./workspace-overlay-routes";
import { SettingsWorkspaceLayout } from "../settings/SettingsWorkspaceLayout";
import { WorkspaceThreadSidebar } from "./workspace/WorkspaceThreadSidebar";

export { useAdaptiveWorkspaceLayout, useWorkspacePaneState };

/**
 * Shows these panes in the workspace's inspector while this screen is focused. Register on focus
 * events because frozen blurred screens may never clean up.
 */
export function Inspector(props: {
  readonly content: InspectorContent;
  /** Opens the column the first time this key registers while its route stays on the stack. */
  readonly revealKey?: string;
}) {
  const { registerWorkspaceInspector } = useAdaptiveWorkspaceLayout();
  const navigation = use(NavigationContext);
  const route = use(NavigationRouteContext);
  const content: InspectorContent = {
    ...props.content,
    resetKeys: [route?.key, ...(props.content.resetKeys ?? [])],
    panes: props.content.panes.map((pane) => ({
      ...pane,
      render: () => (
        <NavigationContext.Provider value={navigation}>
          <NavigationRouteContext.Provider value={route}>
            {pane.render()}
          </NavigationRouteContext.Provider>
        </NavigationContext.Provider>
      ),
    })),
  };
  const focusedRef = useRef(false);
  const deactivateRef = useRef<(() => void) | null>(null);

  const syncRegistration = useEffectEvent(() => {
    if (!focusedRef.current) {
      deactivateRef.current?.();
      return;
    }
    deactivateRef.current = registerWorkspaceInspector(content, route?.key, props.revealKey);
  });

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Navigation focus events own the inspector registration lifetime.
  useEffect(() => {
    if (navigation === undefined) return;
    const focus = () => {
      if (focusedRef.current) return;
      focusedRef.current = true;
      syncRegistration();
    };
    const blur = () => {
      focusedRef.current = false;
      syncRegistration();
    };
    if (navigation.isFocused()) focus();
    const unsubscribeFocus = navigation.addListener("focus", focus);
    const unsubscribeBlur = navigation.addListener("blur", blur);
    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
      focusedRef.current = false;
      deactivateRef.current?.();
      deactivateRef.current = null;
    };
  }, [navigation]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Changed column content replaces the focused inspector registration.
  useEffect(() => {
    if (focusedRef.current) {
      syncRegistration();
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Changed column content replaces its existing native workspace registration.
  }, [props.content, props.revealKey]);
  return null;
}

function useStableActions(actions: Required<AdaptiveWorkspaceActions>): AdaptiveWorkspaceActions {
  const latest = useRef(actions);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- points the stable actions at the handlers this commit rendered
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const [stable] = useState((): AdaptiveWorkspaceActions => ({
    startNewTask: () => latest.current.startNewTask(),
    selectDetail: (detail, sheet) => latest.current.selectDetail(detail, sheet),
    registerWorkspaceInspector: (content, routeKey, revealKey) =>
      latest.current.registerWorkspaceInspector(content, routeKey, revealKey),
    setPrimarySidebarSearchQuery: (query) => latest.current.setPrimarySidebarSearchQuery(query),
    showInspector: () => latest.current.showInspector(),
    toggleAuxiliaryPane: () => latest.current.toggleAuxiliaryPane(),
    togglePrimarySidebar: () => latest.current.togglePrimarySidebar(),
    revealPrimarySidebar: () => latest.current.revealPrimarySidebar(),
    setPrimarySidebarVisible: (visible) => latest.current.setPrimarySidebarVisible(visible),
    openWorkspaceTab: (tab, options) => latest.current.openWorkspaceTab(tab, options),
    setAuxiliaryPaneWidth: (width) => latest.current.setAuxiliaryPaneWidth(width),
    setNativeInspectorWidth: (width) => latest.current.setNativeInspectorWidth(width),
  }));
  return stable;
}

export function AdaptiveWorkspaceLayout(props: {
  readonly children: ReactNode;
  readonly pathname: string;
  readonly workspaceRouteKey: string | undefined;
  readonly workspaceRouteName: string | undefined;
}) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  if (!AsyncResult.isSuccess(preferencesResult)) {
    return AsyncResult.isFailure(preferencesResult) ? (
      <AdaptiveWorkspaceLayoutContent
        {...props}
        projectGroupingMode={DEFAULT_MOBILE_PROJECT_GROUPING_SETTINGS.sidebarProjectGroupingMode}
      />
    ) : null;
  }
  const groupingSettings = resolveMobileProjectGroupingSettings(preferencesResult.value);
  return (
    <AdaptiveWorkspaceLayoutContent
      {...props}
      projectGroupingMode={groupingSettings.sidebarProjectGroupingMode}
      savedThreadListFilters={preferencesResult.value.threadListFilters}
    />
  );
}

function AdaptiveWorkspaceLayoutContent(
  props: {
    readonly children: ReactNode;
    readonly pathname: string;
    readonly workspaceRouteKey: string | undefined;
    readonly workspaceRouteName: string | undefined;
  } & {
    readonly projectGroupingMode: SidebarProjectGroupingMode;
    readonly savedThreadListFilters?: ThreadListFilters | undefined;
  },
) {
  const floatingTabsEnabled = useAndroidFloatingTabs();
  const projectGroupingMode = props.projectGroupingMode;
  const nativeWorkspace = use(NativeWorkspaceModeContext);
  const usesPresentationHost = use(WorkspacePresentationHostContext);
  const windowDimensions = useWindowDimensions();
  const nativeMetrics = useNativeLayoutMetrics();
  const { width: viewportWidth, height } = nativeMetrics ?? windowDimensions;
  const pathname = props.pathname;
  const workspace = useWorkspaceTabs();
  const androidSettingsOpen = useAndroidWorkspaceRoot()?.settingsOpen ?? false;
  const safeAreaInsets = useSafeAreaInsets();
  const workspacePage =
    Platform.OS === "android" && (androidSettingsOpen || workspace?.state.selectedTab === "usage");
  const navigation = useNavigation();
  const [primarySidebarPreferredVisible, setPrimarySidebarPreferredVisible] = useState(true);
  const [fileInspectorPreferredVisible, setFileInspectorPreferredVisible] = useState(true);
  const [nativeInspectorWidthFraction, setNativeInspectorWidthFraction] = useState(0.4);
  const horizontalSafeArea =
    (nativeMetrics?.safeArea.left ?? 0) + (nativeMetrics?.safeArea.right ?? 0);
  const inspectorWidthFor = (fraction: number) =>
    nativeInspectorColumnWidth({ viewportWidth, horizontalSafeArea, fraction });
  const nativeInspectorWidth = inspectorWidthFor(nativeInspectorWidthFraction);
  const [fileInspectorPreferredWidth, setFileInspectorPreferredWidth] = useState<number | null>(
    null,
  );
  const [primarySidebarSearchQuery, setPrimarySidebarSearchQuery] = useState("");
  const [railOverlay, setRailOverlay] = useState(false);
  const baseLayout = useMemo(
    () => deriveLayout({ width: viewportWidth, height, nativeMetrics, nativeWorkspace }),
    [height, viewportWidth, nativeMetrics, nativeWorkspace],
  );
  const [overlaySidebar, setOverlaySidebar] = useState({
    active: baseLayout.variant === "medium",
    pathname,
    visible: isWorkspaceListPath(pathname),
    keepOpenFor: null as string | null,
  });
  if (
    overlaySidebar.active !== (baseLayout.variant === "medium") ||
    (overlaySidebar.active && overlaySidebar.pathname !== pathname)
  ) {
    setOverlaySidebar({
      active: baseLayout.variant === "medium",
      pathname,
      visible:
        isWorkspaceListPath(pathname) ||
        (overlaySidebar.keepOpenFor !== null &&
          overlaySidebar.keepOpenFor === props.workspaceRouteKey),
      keepOpenFor: null,
    });
  }
  const preferredSidebarVisible =
    baseLayout.variant === "medium" ? overlaySidebar.visible : primarySidebarPreferredVisible;
  const primarySidebarPinned = isPrimarySidebarPinned({
    pathname,
    nativeWorkspace,
    usesSplitView: baseLayout.usesSplitView,
  });
  const showPrimarySidebar = !workspacePage && (primarySidebarPinned || preferredSidebarVisible);
  const sidebarFloats =
    baseLayout.variant === "medium" &&
    (nativeWorkspace || (!primarySidebarPinned && !workspacePage));
  const shouldRenderNavigationRail =
    Platform.OS === "android" && baseLayout.usesSplitView && !floatingTabsEnabled;
  const enabledTabs = useEnabledNavigationTabs();
  const { scale, fabSize } = useAndroidControlSizing();
  const floatingTabs = floatingTabsMetrics(enabledTabs.length + 1, scale, fabSize);
  const navigationRailWidth = shouldRenderNavigationRail ? ANDROID_WORKSPACE_RAIL_WIDTH : 0;
  const [hinge, setHinge] = useState<VerticalHinge | null>(null);
  const [windowHinge, setWindowHinge] = useState<VerticalHinge | null>(null);
  const handleHingeChange = (next: VerticalHinge | null, nextWindow: VerticalHinge | null) => {
    setHinge(next);
    setWindowHinge(nextWindow);
  };
  const layout = useMemo(() => {
    const aligned = alignListPaneToHinge({
      layout: baseLayout,
      hinge,
      viewportWidth,
      leadingWidth: navigationRailWidth,
    });
    if (
      !floatingTabsEnabled ||
      !aligned.usesSplitView ||
      aligned.listPaneGap !== undefined ||
      aligned.listPaneWidth === null ||
      aligned.listPaneWidth >= floatingTabs.row ||
      viewportWidth - floatingTabs.row < 320
    )
      return aligned;
    return { ...aligned, listPaneWidth: floatingTabs.row };
  }, [
    baseLayout,
    hinge,
    navigationRailWidth,
    viewportWidth,
    floatingTabs.row,
    floatingTabsEnabled,
  ]);
  const width = viewportWidth - navigationRailWidth;
  const shouldRenderPrimarySidebar = layout.usesSplitView;
  const fileInspector = useMemo(
    () =>
      deriveFileInspectorPaneLayout({
        layout,
        viewportWidth: width,
        preferredWidth: fileInspectorPreferredWidth ?? undefined,
        reservedLeadingWidth:
          shouldRenderPrimarySidebar && showPrimarySidebar && !sidebarFloats
            ? (layout.listPaneWidth ?? 0) + (layout.listPaneGap ?? 0)
            : 0,
      }),
    [
      fileInspectorPreferredWidth,
      layout,
      showPrimarySidebar,
      shouldRenderPrimarySidebar,
      sidebarFloats,
      width,
    ],
  );
  const [workspaceInspector, setWorkspaceInspector] = useState<{
    readonly content: InspectorContent;
    readonly active: boolean;
    readonly routeKey: string | undefined;
  } | null>(null);
  const [inspectorSheetRoute, setInspectorSheetRoute] = useState<string | null>(null);
  const inspectorSheetOpen =
    !fileInspector.supported &&
    !workspacePage &&
    inspectorSheetRoute !== null &&
    workspaceInspector?.active === true &&
    workspaceInspector.routeKey === inspectorSheetRoute;
  const inspectorActive = workspaceInspector?.active ?? false;
  const panes = useMemo(
    () =>
      deriveWorkspacePaneLayout({
        layout,
        viewportWidth: width,
        horizontalSafeArea,
        nativeWorkspace,
        primarySidebarFloats: sidebarFloats,
        primarySidebarPreferredVisible: showPrimarySidebar,
        auxiliaryPanePreferredVisible:
          !workspacePage && inspectorActive && fileInspectorPreferredVisible,
        auxiliaryPanePreferredWidth: fileInspectorPreferredWidth ?? undefined,
        nativeInspectorWidth,
      }),
    [
      nativeInspectorWidth,
      horizontalSafeArea,
      fileInspectorPreferredVisible,
      fileInspectorPreferredWidth,
      inspectorActive,
      layout,
      nativeWorkspace,
      showPrimarySidebar,
      sidebarFloats,
      width,
      workspacePage,
    ],
  );
  const revealedInspectors = useRef<ReadonlyMap<string, string>>(new Map());
  const workspaceInspectorOwner = useRef<symbol | null>(null);
  const registerWorkspaceInspector = (
    content: InspectorContent,
    routeKey: string | undefined,
    revealKey?: string,
  ) => {
    const owner = Symbol("workspace-inspector");
    workspaceInspectorOwner.current = owner;
    setWorkspaceInspector({ content, active: true, routeKey });
    if (
      routeKey !== undefined &&
      revealKey !== undefined &&
      revealedInspectors.current.get(routeKey) !== revealKey
    ) {
      const state = rootStackState(navigation);
      const live = new Set(state?.routes.slice(0, state.index + 1).map((route) => route.key));
      revealedInspectors.current = new Map(
        [...revealedInspectors.current, [routeKey, revealKey] as const].filter(
          ([key]) => live.has(key) || key === routeKey,
        ),
      );
      setFileInspectorPreferredVisible(true);
    }

    return () => {
      if (workspaceInspectorOwner.current !== owner) {
        return;
      }
      setWorkspaceInspector((current) => (current === null ? null : { ...current, active: false }));
    };
  };
  const handleWorkspaceInspectorClosed = () => {
    setWorkspaceInspector((current) => (current !== null && !current.active ? null : current));
  };
  const setPrimarySidebarVisible = (visible: boolean) => {
    if (layout.variant === "medium") {
      setOverlaySidebar((current) => ({ ...current, visible }));
    } else {
      setPrimarySidebarPreferredVisible(visible);
    }
  };
  const togglePrimarySidebar = () => {
    if (primarySidebarPinned) {
      return;
    }
    if (!panes.primarySidebarVisible && panes.primarySidebarSuppressedByAuxiliary) {
      setFileInspectorPreferredVisible(false);
      setPrimarySidebarPreferredVisible(true);
      return;
    }
    setPrimarySidebarVisible(!preferredSidebarVisible);
  };
  const revealPrimarySidebar = () => {
    if (panes.primarySidebarSuppressedByAuxiliary) {
      setFileInspectorPreferredVisible(false);
    }
    setPrimarySidebarVisible(true);
  };
  const handleToggleSidebarCommand = () => {
    togglePrimarySidebar();
    return true;
  };
  const sidebarCommands = primarySidebarPinned ? [] : (["toggleSidebar"] as const);
  useHardwareKeyboardCommand(sidebarCommands, handleToggleSidebarCommand);
  const dismissInspectorSheet = () => {
    setFileInspectorPreferredVisible(false);
    setInspectorSheetRoute(null);
  };
  const showInspector = () => {
    setFileInspectorPreferredVisible(true);
    if (fileInspector.supported) {
      setInspectorSheetRoute(null);
      return;
    }
    const state = rootStackState(navigation);
    const top = workspaceRoutesOf(state?.routes.slice(0, state.index + 1) ?? []).workspace.at(-1);
    setInspectorSheetRoute(top?.key ?? null);
  };
  const handleOpenFilesCommand = () => {
    const activeThread = parseActiveThreadPath(pathname);
    if (!layout.usesSplitView || !fileInspector.supported || activeThread === null) {
      return false;
    }
    showInspector();
    if (props.workspaceRouteName === "ThreadFiles" || props.workspaceRouteName === "ThreadFile") {
      return true;
    }
    navigation.navigate("ThreadFiles", activeThread);
    return true;
  };
  useHardwareKeyboardCommand("files", handleOpenFilesCommand);
  const toggleAuxiliaryPane = () => {
    if (fileInspector.supported) {
      setFileInspectorPreferredVisible((current) => !current);
      setInspectorSheetRoute(null);
    } else if (inspectorSheetOpen) dismissInspectorSheet();
    else showInspector();
  };
  const openWorkspaceTab = (
    tab: WorkspaceTab | "settings",
    options?: { readonly columns?: boolean },
  ) => {
    const state = rootStackState(navigation);
    if (!state) return;
    const { workspace, overlays } = workspaceRoutesOf(state.routes.slice(0, state.index + 1));
    const next = workspaceTabNavigationState(
      { ...state, routes: workspace },
      tab,
      currentWorkspaceSelections(),
      {
        columns: workspaceTabColumns(Platform.OS, tab, options?.columns ?? layout.usesSplitView),
        check: workspaceSelectionCheck,
        overlays,
        seedPullRequest: withKnownPullRequestSummary,
      },
    );
    if (layout.variant === "medium") {
      const opened = next.routes.at(-1 - overlays.length)?.key ?? null;
      setOverlaySidebar((current) => ({ ...current, visible: true, keepOpenFor: opened }));
    }
    dispatchRootStackReset(navigation, state, next);
  };
  const handleOpenSettings = () => openWorkspaceTab("settings");

  function handleSelectDetail(detail: WorkspaceDetail, sheet?: WorkspaceDetailSheet) {
    threadSelectionDeferral.run(() => {
      if (Platform.OS === "android") Keyboard.dismiss();
      setFileInspectorPreferredVisible(false);
      setInspectorSheetRoute(null);
      if (layout.variant === "medium") setPrimarySidebarVisible(false);
      workspace?.dispatch({ type: "select", tab: workspaceTabOf(detail.name) });
      startOpeningDetail(detail);
      navigation.dispatch(selectWorkspaceDetail(detail, sheet));
    });
  }
  const handleSelectThreadRoute = (params: ReactNavigation.RootParamList["Thread"]) =>
    handleSelectDetail({ name: "Thread", params });

  const compactAndroidSettings =
    Platform.OS === "android" && androidSettingsOpen && !layout.usesSplitView;
  const handleStartNewTask = () => {
    void readStartNewTaskDestination(uuidv4()).then(handleSelectThreadRoute);
  };

  useHardwareKeyboardCommand("newTask", () => {
    handleStartNewTask();
    return true;
  });

  const inspectorColumnTargetWidth = panes.auxiliaryPaneVisible
    ? (panes.auxiliaryPaneWidth ?? 0)
    : 0;
  const contentEndGap = Platform.OS === "android" && layout.usesSplitView ? 4 : 0;
  const stripSidebar =
    Platform.OS === "android" &&
    layout.usesSplitView &&
    layout.listPaneWidth !== null &&
    !workspacePage &&
    !sidebarFloats;
  const sidebarSlotWidth = (layout.listPaneWidth ?? 0) + (layout.listPaneGap ?? 0);
  const contentSpansSidebar = stripSidebar && !panes.primarySidebarVisible;
  const contentTargetWidth = !layout.usesSplitView
    ? null
    : Math.max(
        0,
        (contentSpansSidebar ? width : panes.contentPaneWidth) -
          inspectorColumnTargetWidth -
          contentEndGap,
      );
  const workspacePageWidth = !layout.usesSplitView
    ? null
    : workspacePage
      ? contentTargetWidth
      : Math.max(
          0,
          viewportWidth -
            (shouldRenderNavigationRail ? ANDROID_WORKSPACE_RAIL_WIDTH : 0) -
            contentEndGap,
        );
  const [listPaneSizing, setListPaneSizing] = useState({
    viewportWidth,
    workspacePage,
    sidebarVisible: panes.primarySidebarVisible,
    listPaneTarget: layout.listPaneWidth,
    listPaneFloor: layout.listPaneWidth,
    listPaneCeiling: layout.listPaneWidth,
    revision: 0,
  });
  if (
    Platform.OS === "android" &&
    (listPaneSizing.viewportWidth !== viewportWidth ||
      listPaneSizing.workspacePage !== workspacePage ||
      listPaneSizing.sidebarVisible !== panes.primarySidebarVisible ||
      listPaneSizing.listPaneTarget !== layout.listPaneWidth)
  ) {
    const resizingSidebar =
      listPaneSizing.viewportWidth === viewportWidth &&
      listPaneSizing.workspacePage === workspacePage &&
      listPaneSizing.sidebarVisible &&
      panes.primarySidebarVisible &&
      listPaneSizing.listPaneTarget !== layout.listPaneWidth;
    setListPaneSizing({
      viewportWidth,
      workspacePage,
      sidebarVisible: panes.primarySidebarVisible,
      listPaneTarget: layout.listPaneWidth,
      listPaneFloor: resizingSidebar
        ? Math.min(listPaneSizing.listPaneFloor ?? 0, layout.listPaneWidth ?? 0)
        : layout.listPaneWidth,
      listPaneCeiling: resizingSidebar
        ? Math.max(listPaneSizing.listPaneCeiling ?? 0, layout.listPaneWidth ?? 0)
        : layout.listPaneWidth,
      revision: listPaneSizing.revision + 1,
    });
  }
  const settleListPane = (revision: number) => {
    setListPaneSizing((current) =>
      current.revision !== revision ||
      (current.listPaneFloor === current.listPaneTarget &&
        current.listPaneCeiling === current.listPaneTarget)
        ? current
        : {
            ...current,
            listPaneFloor: current.listPaneTarget,
            listPaneCeiling: current.listPaneTarget,
          },
    );
  };
  const listPaneFloor = listPaneSizing.listPaneFloor ?? 0;
  const listPaneCeiling = listPaneSizing.listPaneCeiling ?? 0;
  const listPaneRevision = listPaneSizing.revision;
  const contentLeftTarget = sidebarFloats
    ? navigationRailWidth
    : navigationRailWidth +
      (shouldRenderPrimarySidebar && !workspacePage && panes.primarySidebarVisible
        ? (layout.listPaneWidth ?? 0) + (layout.listPaneGap ?? 0)
        : 0);
  const [contentAnchor, setContentAnchor] = useState({
    viewportWidth,
    left: contentLeftTarget,
    inspector: inspectorColumnTargetWidth,
    end: false,
  });
  if (
    Platform.OS === "android" &&
    (contentAnchor.viewportWidth !== viewportWidth ||
      contentAnchor.left !== contentLeftTarget ||
      contentAnchor.inspector !== inspectorColumnTargetWidth)
  ) {
    setContentAnchor({
      viewportWidth,
      left: contentLeftTarget,
      inspector: inspectorColumnTargetWidth,
      end:
        contentAnchor.viewportWidth === viewportWidth &&
        contentAnchor.inspector === inspectorColumnTargetWidth,
    });
  }

  const renderedSidebarWidth = useSharedValue(
    panes.primarySidebarVisible ? (layout.listPaneWidth ?? 0) + (layout.listPaneGap ?? 0) : 0,
  );
  const renderedRailWidth = useSharedValue(navigationRailWidth);
  const leavingWorkspacePage = useRef(false);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- animates the Reanimated rail and sidebar width shared values toward the layout's targets
  useEffect(() => {
    if (nativeWorkspace) return;
    renderedRailWidth.set(withTiming(navigationRailWidth, WORKSPACE_PANE_TIMING));
    if (workspacePage) {
      leavingWorkspacePage.current = true;
      return;
    }
    const snap = leavingWorkspacePage.current;
    leavingWorkspacePage.current = false;
    const targetWidth = panes.primarySidebarVisible
      ? (layout.listPaneWidth ?? 0) + (layout.listPaneGap ?? 0)
      : 0;
    renderedSidebarWidth.set(
      withTiming(targetWidth, snap ? { duration: 0 } : WORKSPACE_PANE_TIMING, (finished) => {
        if (finished && Platform.OS === "android" && listPaneFloor !== listPaneCeiling) {
          runOnJS(settleListPane)(listPaneRevision);
        }
      }),
    );
  }, [
    nativeWorkspace,
    navigationRailWidth,
    layout.listPaneWidth,
    layout.listPaneGap,
    panes.primarySidebarVisible,
    renderedSidebarWidth,
    renderedRailWidth,
    settleListPane,
    listPaneFloor,
    listPaneCeiling,
    listPaneRevision,
    workspacePage,
  ]);
  const railAnimatedStyle = useAnimatedStyle(() => ({ width: renderedRailWidth.value }));
  const floatingSidebarAnimatedStyle = useAnimatedStyle(() => ({
    left: sidebarFloats ? renderedRailWidth.value : 0,
  }));
  const floatingSidebarOpen = sidebarFloats && panes.primarySidebarVisible;
  const scrimOpacity = useSharedValue(0);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- animates the Reanimated scrim with the floating sidebar
  useEffect(() => {
    scrimOpacity.set(withTiming(floatingSidebarOpen ? 0.32 : 0, WORKSPACE_PANE_TIMING));
  }, [floatingSidebarOpen, scrimOpacity]);
  const scrimAnimatedStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }));
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Back closes a floating sidebar before it leaves the page
  useEffect(() => {
    if (!floatingSidebarOpen || nativeWorkspace) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const state = rootStackState(navigation);
      if (state && workspaceRoutesOf(state.routes.slice(0, state.index + 1)).overlays.length > 0) {
        return false;
      }
      setPrimarySidebarVisible(false);
      return true;
    });
    return () => subscription.remove();
  }, [floatingSidebarOpen, nativeWorkspace, navigation, setPrimarySidebarVisible]);
  const listPaneGap = layout.listPaneGap ?? 0;
  const listPaneAnimatedStyle = useAnimatedStyle(() => ({
    width: Math.min(
      listPaneCeiling,
      Math.max(
        listPaneFloor,
        (stripSidebar ? sidebarSlotWidth : renderedSidebarWidth.value) - listPaneGap,
      ),
    ),
  }));
  const stripOffset = useDerivedValue(() =>
    stripSidebar ? renderedSidebarWidth.value - sidebarSlotWidth : 0,
  );
  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    opacity:
      stripSidebar || Platform.OS === "ios" || floatingTabsEnabled
        ? 1
        : Math.min(1, renderedSidebarWidth.value / 80),
    width: stripSidebar ? sidebarSlotWidth : renderedSidebarWidth.value,
    flexShrink: stripSidebar ? 0 : 1,
    transform: [{ translateX: stripOffset.value }],
  }));

  const renderedInspectorWidth = useSharedValue(inspectorColumnTargetWidth);
  const renderedContentWidth = useDerivedValue(() =>
    Math.max(
      0,
      viewportWidth -
        renderedRailWidth.value -
        (workspacePage || sidebarFloats ? 0 : renderedSidebarWidth.value) -
        renderedInspectorWidth.value,
    ),
  );
  const androidSplit = Platform.OS === "android" && layout.usesSplitView;
  const androidContentSlotStyle = useAnimatedStyle(() =>
    !androidSplit
      ? { width: "100%" as const, marginRight: 0, transform: [{ translateX: 0 }] }
      : stripSidebar
        ? {
            width: Math.max(
              0,
              viewportWidth - renderedRailWidth.value - renderedInspectorWidth.value,
            ),
            marginRight: -sidebarSlotWidth,
            transform: [{ translateX: stripOffset.value }],
          }
        : { width: renderedContentWidth.value, marginRight: 0, transform: [{ translateX: 0 }] },
  );
  const androidNavigatorLimit = useAnimatedStyle(() => ({
    maxWidth: stripSidebar
      ? viewportWidth
      : androidSplit &&
          contentTargetWidth !== null &&
          renderedContentWidth.value < contentTargetWidth
        ? contentTargetWidth
        : ("100%" as const),
  }));

  const sidebarOverRotates =
    nativeWorkspace && nativeMetrics?.hasHinge === true && layout.usesSplitView;
  const sidebarInLandscape =
    baseLayout.variant === "medium"
      ? primarySidebarPinned || primarySidebarPreferredVisible
      : panes.primarySidebarVisible;
  const sidebarInPortrait =
    primarySidebarPinned ||
    (baseLayout.variant === "medium" ? overlaySidebar.visible : isWorkspaceListPath(pathname));
  const sidebarByOrientation = useMemo(
    () =>
      sidebarOverRotates ? { landscape: sidebarInLandscape, portrait: sidebarInPortrait } : null,
    [sidebarInLandscape, sidebarInPortrait, sidebarOverRotates],
  );

  const actions = useStableActions({
    startNewTask: handleStartNewTask,
    selectDetail: handleSelectDetail,
    registerWorkspaceInspector,
    setPrimarySidebarSearchQuery,
    showInspector,
    toggleAuxiliaryPane,
    togglePrimarySidebar,
    revealPrimarySidebar,
    setPrimarySidebarVisible,
    openWorkspaceTab,
    setAuxiliaryPaneWidth: setFileInspectorPreferredWidth,
    setNativeInspectorWidth: (width: number) =>
      setNativeInspectorWidthFraction(inspectorWidthFor(width / viewportWidth) / viewportWidth),
  });
  const contextValue = useMemo(
    () => ({ ...actions, layout, nativeInspectorWidth, workspacePageWidth }),
    [actions, layout, nativeInspectorWidth, workspacePageWidth],
  );
  const sidebarToggleable = layout.usesSplitView && !primarySidebarPinned && !workspacePage;
  const paneState = useMemo(
    () => ({
      panes,
      fileInspector,
      primarySidebarSearchQuery,
      sidebarToggleable,
      sidebarByOrientation,
    }),
    [panes, fileInspector, primarySidebarSearchQuery, sidebarToggleable, sidebarByOrientation],
  );

  const inspectorSheet = (
    <WorkspaceInspectorSheet
      open={inspectorSheetOpen}
      onClose={dismissInspectorSheet}
      content={workspaceInspector?.content}
    />
  );
  if (nativeWorkspace) {
    return (
      <HomeListOptionsProvider
        projectGroupingMode={projectGroupingMode}
        savedFilters={props.savedThreadListFilters}
      >
        <AdaptiveWorkspaceContext value={contextValue}>
          <WorkspacePaneStateContext value={paneState}>
            <NativeWorkspaceInspectorContext
              value={{
                content: fileInspector.supported ? workspaceInspector?.content : undefined,
                visible: inspectorColumnTargetWidth > 0,
              }}
            >
              {props.children}
              {inspectorSheet}
            </NativeWorkspaceInspectorContext>
          </WorkspacePaneStateContext>
        </AdaptiveWorkspaceContext>
      </HomeListOptionsProvider>
    );
  }
  const renderColumns = (children: ReactNode, sidebar?: ReactNode) => (
    <View
      testID="adaptive-workspace-layout"
      className={Platform.OS === "android" ? "flex-1 flex-row bg-header" : "flex-1 flex-row"}
    >
      <AndroidHingeObserver onChange={handleHingeChange} />
      {shouldRenderNavigationRail ? (
        <Animated.View className="shrink self-stretch" style={railAnimatedStyle} />
      ) : null}
      {shouldRenderPrimarySidebar && layout.listPaneWidth !== null ? (
        <Animated.View
          className="self-stretch overflow-hidden android:shrink"
          accessibilityElementsHidden={workspacePage || !panes.primarySidebarVisible}
          collapsable={false}
          importantForAccessibility={
            !workspacePage && panes.primarySidebarVisible ? "auto" : "no-hide-descendants"
          }
          pointerEvents={!workspacePage && panes.primarySidebarVisible ? "auto" : "none"}
          style={[
            workspacePage ? { position: "absolute", top: 0, bottom: 0, left: 0 } : null,
            sidebarFloats
              ? { position: "absolute", top: 0, bottom: 0, zIndex: 2, elevation: 8 }
              : null,
            floatingSidebarAnimatedStyle,
            sidebarAnimatedStyle,
          ]}
        >
          <Animated.View className="flex-1" style={listPaneAnimatedStyle}>
            <PaneContext value="sidebar">
              <RenderErrorBoundary
                renderFallback={(fallback) => (
                  <RenderFailureView
                    {...fallback}
                    title="The sidebar couldn't be displayed"
                    exit={{ label: "Open settings", onPress: handleOpenSettings }}
                  />
                )}
              >
                {sidebar ?? <WorkspaceThreadSidebar />}
              </RenderErrorBoundary>
            </PaneContext>
            {floatingTabsEnabled && !workspacePage ? (
              <FloatingWorkspaceTabs
                paneWidth={layout.listPaneWidth}
                onNewThread={handleStartNewTask}
                onSelect={revealPrimarySidebar}
              />
            ) : null}
          </Animated.View>
        </Animated.View>
      ) : null}
      <Animated.View
        className={
          Platform.OS === "android"
            ? "max-w-full shrink-0 overflow-hidden bg-header"
            : "flex-1 overflow-hidden bg-screen"
        }
        style={Platform.OS === "android" ? androidContentSlotStyle : undefined}
        collapsable={false}
        importantForAccessibility={floatingSidebarOpen ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={floatingSidebarOpen}
      >
        <Animated.View
          collapsable={false}
          style={[
            contentTargetWidth !== null
              ? {
                  flex: 1,
                  width: contentTargetWidth,
                  alignSelf: contentAnchor.end && !stripSidebar ? "flex-end" : "flex-start",
                  marginRight: contentAnchor.end && !stripSidebar ? contentEndGap : 0,
                }
              : { flex: 1 },
            Platform.OS === "android" ? androidNavigatorLimit : undefined,
          ]}
        >
          <WorkspaceContentWidthContext
            value={layout.usesSplitView && Platform.OS !== "android" ? renderedContentWidth : null}
          >
            <WorkspaceSettledContentWidthContext
              value={Platform.OS === "android" && layout.usesSplitView ? contentTargetWidth : null}
            >
              <SafeAreaInsetsContext
                value={
                  floatingTabsEnabled &&
                  (compactAndroidSettings || (layout.usesSplitView && workspacePage))
                    ? {
                        ...safeAreaInsets,
                        bottom:
                          safeAreaInsets.bottom +
                          FLOATING_TABS.bottom +
                          FLOATING_TABS.edge +
                          floatingTabs.height,
                      }
                    : compactAndroidSettings
                      ? { ...safeAreaInsets, bottom: 0 }
                      : safeAreaInsets
                }
              >
                <View className="flex-1">
                  <PaneContext value="content">
                    <SettingsWorkspaceLayout>{children}</SettingsWorkspaceLayout>
                  </PaneContext>
                </View>
              </SafeAreaInsetsContext>
              {floatingTabsEnabled &&
              (compactAndroidSettings || (layout.usesSplitView && workspacePage)) ? (
                <FloatingWorkspaceTabs
                  paneWidth={layout.usesSplitView ? (layout.listPaneWidth ?? undefined) : undefined}
                  fillWidth={compactAndroidSettings}
                  onNewThread={handleStartNewTask}
                />
              ) : compactAndroidSettings ? (
                <AndroidWorkspaceNavigation onNewThread={handleStartNewTask} />
              ) : null}
            </WorkspaceSettledContentWidthContext>
          </WorkspaceContentWidthContext>
        </Animated.View>
      </Animated.View>
      {sidebarFloats ? (
        <Animated.View
          className="absolute inset-0 bg-black"
          pointerEvents={floatingSidebarOpen ? "auto" : "none"}
          style={[{ zIndex: 1 }, scrimAnimatedStyle]}
        >
          <Pressable
            accessibilityLabel="Hide sidebar"
            className="flex-1"
            onPress={() => setPrimarySidebarVisible(false)}
          />
        </Animated.View>
      ) : null}
      <PaneContext value="inspector">
        <WorkspaceInspectorPane
          renderedInspectorWidth={renderedInspectorWidth}
          active={workspaceInspector?.active ?? false}
          panes={panes}
          content={workspaceInspector?.content}
          setAuxiliaryPaneWidth={setFileInspectorPreferredWidth}
          onClose={() => setFileInspectorPreferredVisible(false)}
          onClosed={handleWorkspaceInspectorClosed}
        />
      </PaneContext>
      {inspectorSheet}
      {shouldRenderNavigationRail && navigationRailWidth > 0 ? (
        <View
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={[
            railOverlay
              ? { right: 0 }
              : { right: viewportWidth - navigationRailWidth, maxWidth: navigationRailWidth },
            sidebarFloats ? { zIndex: 3, elevation: 8 } : null,
          ]}
        >
          <AndroidWorkspaceNavigation
            onNewThread={handleStartNewTask}
            rail
            onSelect={revealPrimarySidebar}
            onOverlayChange={setRailOverlay}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <HomeListOptionsProvider
      projectGroupingMode={projectGroupingMode}
      savedFilters={props.savedThreadListFilters}
    >
      <AdaptiveWorkspaceContext value={contextValue}>
        <WorkspacePaneStateContext value={paneState}>
          <WindowHingeContext value={windowHinge}>
            {usesPresentationHost ? (
              <WorkspaceColumnsRendererContext value={renderColumns}>
                {props.children}
              </WorkspaceColumnsRendererContext>
            ) : (
              renderColumns(props.children)
            )}
          </WindowHingeContext>
        </WorkspacePaneStateContext>
      </AdaptiveWorkspaceContext>
    </HomeListOptionsProvider>
  );
}
