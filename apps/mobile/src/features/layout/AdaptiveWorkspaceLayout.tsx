import {
  WorkspaceColumnsRendererContext,
  WorkspacePresentationHostContext,
} from "./workspace-presentation-context";
import { useAndroidFloatingTabs } from "../settings/appearance/AppearancePreferencesProvider";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveWorkspaceContext, useAdaptiveWorkspaceLayout } from "./adaptive-workspace-context";
import { threadSelectionDeferral } from "./deferred-navigation";
import { uuidv4 } from "../../lib/uuid";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import { EnvironmentId, ThreadId, type SidebarProjectGroupingMode } from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect } from "@react-navigation/native";
import { NavigationContext, NavigationRouteContext, useNavigation } from "@react-navigation/native";
import { use, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, useWindowDimensions, View } from "react-native";
import { KeyboardController, useKeyboardState } from "react-native-keyboard-controller";
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
  type WorkspaceAuxiliaryPaneRole,
} from "../../lib/layout";
import { scopedThreadKey } from "../../lib/scopedEntities";
import type { ThreadListFilters } from "../../persistence/mobile-preferences";
import { appAtomRegistry } from "../../state/atom-registry";
import { useProjects } from "../../state/entities";
import { useThreadCwd } from "../../state/use-selected-thread-worktree";
import { environmentThreadShells } from "../../state/threads";
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
import { useEnabledNavigationTabs } from "../workspace/navigation-tabs";
import { FLOATING_TABS, floatingTabsMetrics } from "../workspace/floating-workspace-tabs";
import { AndroidHomeFabLayout } from "../home/AndroidHomeFab";
import {
  AndroidWorkspaceNavigation,
  FloatingWorkspaceTabs,
  ANDROID_WORKSPACE_RAIL_WIDTH,
} from "../workspace/AndroidWorkspaceNavigation";
import { AndroidWorkspaceSidebar } from "../workspace/AndroidWorkspaceSidebar";
import {
  selectWorkspaceDetail,
  type WorkspaceDetail,
  type WorkspaceDetailSheet,
} from "../workspace/workspace-detail-selection";
import { startOpeningDetail } from "../workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { HomeListOptionsProvider } from "../home/home-list-options";
import { usePendingTaskListActions } from "../home/usePendingTaskListActions";
import { ThreadNavigationSidebar } from "../threads/ThreadNavigationSidebar";
import { useOpenThreadPullRequests } from "../threads/use-open-thread-pull-requests";
import { newTaskDestination } from "../threads/new-task-project-selection";
import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import { WORKSPACE_PANE_TIMING } from "./workspace-pane-animation";

import { WorkspaceInspectorPane } from "./workspace-inspector-pane";
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
import { useAndroidWorkspaceRoot } from "../workspace/AndroidWorkspaceTabsProvider";
import { openSettings } from "../settings/settings-navigation";
import { dispatchRootStackReset, rootStackState } from "../../lib/root-stack-reset";
import {
  currentWorkspaceSelections,
  workspaceSelectionCheck,
} from "../workspace/workspace-selection-store";
import {
  workspaceTabColumns,
  workspaceTabNavigationState,
} from "../workspace/workspace-tab-navigation";
import type { WorkspaceTab } from "../workspace/workspace-tabs-state";
import { workspaceRoutesOf } from "./workspace-overlay-routes";
import { SettingsWorkspaceLayout } from "../settings/SettingsWorkspaceLayout";

export { useAdaptiveWorkspaceLayout };

export function useAdaptiveWorkspacePaneRole(role: WorkspaceAuxiliaryPaneRole) {
  const { activateAuxiliaryPaneRole } = useAdaptiveWorkspaceLayout();

  useFocusEffect(() => activateAuxiliaryPaneRole(role));
}

export function useRegisterWorkspaceInspector(render: (() => ReactNode) | undefined) {
  const { registerWorkspaceInspector } = useAdaptiveWorkspaceLayout();
  const navigation = use(NavigationContext);
  const route = use(NavigationRouteContext);

  const wrappedRender = (() => {
    if (render === undefined) {
      return undefined;
    }
    return () => (
      <NavigationContext.Provider value={navigation}>
        <NavigationRouteContext.Provider value={route}>{render()}</NavigationRouteContext.Provider>
      </NavigationContext.Provider>
    );
  })();

  useFocusEffect(() =>
    wrappedRender === undefined ? undefined : registerWorkspaceInspector(wrappedRender),
  );
}

export function AdaptiveWorkspaceLayout(props: {
  readonly children: ReactNode;
  readonly pathname: string;
  readonly workspaceRouteKey: string | undefined;
  readonly workspaceRouteName: string | undefined;
  readonly workspaceRouteKeys: ReadonlyArray<string>;
  readonly selectedPullRequestKey?: string | null;
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
    readonly workspaceRouteKeys: ReadonlyArray<string>;
    readonly selectedPullRequestKey?: string | null;
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
  const activeRoleOwner = useRef<symbol | null>(null);
  const [railOverlay, setRailOverlay] = useState(false);
  const [primarySidebarPreferredVisible, setPrimarySidebarPreferredVisible] = useState(true);
  const [supplementaryPanePreferredVisible, setSupplementaryPanePreferredVisible] = useState(true);
  const [supplementaryPanePreferredWidth, setSupplementaryPanePreferredWidth] = useState<
    number | null
  >(null);
  const [fileInspectorPreferredVisible, setFileInspectorPreferredVisible] = useState(true);
  const [fileInspectorPreferredWidth, setFileInspectorPreferredWidth] = useState<number | null>(
    null,
  );
  const [primarySidebarSearchQuery, setPrimarySidebarSearchQuery] = useState("");
  const [focusedAuxiliaryPaneRole, setFocusedAuxiliaryPaneRole] =
    useState<WorkspaceAuxiliaryPaneRole | null>(null);

  const baseLayout = useMemo(
    () => deriveLayout({ width: viewportWidth, height, nativeMetrics, nativeWorkspace }),
    [height, viewportWidth, nativeMetrics, nativeWorkspace],
  );

  const [overlaySidebar, setOverlaySidebar] = useState({
    active: baseLayout.primarySidebarOverlaysContent,
    pathname,
    visible: isWorkspaceListPath(pathname),
    keepOpenFor: null as string | null,
  });
  if (
    overlaySidebar.active !== baseLayout.primarySidebarOverlaysContent ||
    (overlaySidebar.active && overlaySidebar.pathname !== pathname)
  ) {
    setOverlaySidebar({
      active: baseLayout.primarySidebarOverlaysContent,
      pathname,
      visible:
        isWorkspaceListPath(pathname) ||
        (overlaySidebar.keepOpenFor !== null &&
          overlaySidebar.keepOpenFor === props.workspaceRouteKey),
      keepOpenFor: null,
    });
  }
  const preferredSidebarVisible = baseLayout.primarySidebarOverlaysContent
    ? overlaySidebar.visible
    : primarySidebarPreferredVisible;
  const primarySidebarPinned = isPrimarySidebarPinned({
    pathname,
    nativeWorkspace,
    usesSplitView: baseLayout.usesSplitView,
  });
  const [composerEditing, setComposerEditing] = useState(false);
  const softKeyboardVisible = useKeyboardState((state) => state.isVisible);

  const composerKeyboardActive = useDeferredValue(
    Platform.OS === "android" && baseLayout.usesSplitView && composerEditing && softKeyboardVisible,
  );
  const showPrimarySidebar =
    !workspacePage &&
    (primarySidebarPinned || (preferredSidebarVisible && !composerKeyboardActive));
  const shouldRenderNavigationRail =
    Platform.OS === "android" && baseLayout.usesSplitView && !floatingTabsEnabled;
  const enabledTabs = useEnabledNavigationTabs();
  const { scale, fabSize } = useAndroidControlSizing();
  const floatingTabs = floatingTabsMetrics(enabledTabs.length + 1, scale, fabSize);
  const navigationRailWidth =
    shouldRenderNavigationRail && (showPrimarySidebar || workspacePage)
      ? ANDROID_WORKSPACE_RAIL_WIDTH
      : 0;
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
        viewportWidth,
        preferredWidth: fileInspectorPreferredWidth ?? undefined,
        reservedLeadingWidth:
          shouldRenderPrimarySidebar && showPrimarySidebar && !layout.primarySidebarOverlaysContent
            ? (layout.listPaneWidth ?? 0) + (layout.listPaneGap ?? 0)
            : 0,
      }),
    [
      fileInspectorPreferredWidth,
      layout,
      showPrimarySidebar,
      shouldRenderPrimarySidebar,
      viewportWidth,
    ],
  );
  const auxiliaryPaneRole: WorkspaceAuxiliaryPaneRole =
    focusedAuxiliaryPaneRole ?? (/\/files(?:\/|$)/.test(pathname) ? "inspector" : "supplementary");
  const auxiliaryPanePreferredVisible =
    auxiliaryPaneRole === "inspector"
      ? fileInspectorPreferredVisible
      : supplementaryPanePreferredVisible;
  const auxiliaryPanePreferredWidth =
    auxiliaryPaneRole === "inspector"
      ? fileInspectorPreferredWidth
      : supplementaryPanePreferredWidth;
  const panes = useMemo(
    () =>
      deriveWorkspacePaneLayout({
        layout,
        viewportWidth: width,
        nativeWorkspace,
        primarySidebarPreferredVisible: showPrimarySidebar,
        auxiliaryPanePreferredVisible,
        auxiliaryPaneRole,
        auxiliaryPanePreferredWidth: auxiliaryPanePreferredWidth ?? undefined,
      }),
    [
      auxiliaryPanePreferredVisible,
      auxiliaryPaneRole,
      auxiliaryPanePreferredWidth,
      layout,
      nativeWorkspace,
      showPrimarySidebar,
      width,
    ],
  );
  const activeThread = parseActiveThreadPath(pathname);
  const environmentId = activeThread?.environmentId ?? null;
  const threadId = activeThread?.threadId ?? null;
  const selectedThreadRef = (() => {
    if (environmentId === null || threadId === null) {
      return null;
    }
    try {
      return {
        environmentId: EnvironmentId.make(environmentId),
        threadId: ThreadId.make(threadId),
      };
    } catch {
      return null;
    }
  })();
  const selectedThreadKey =
    selectedThreadRef === null
      ? null
      : scopedThreadKey(selectedThreadRef.environmentId, selectedThreadRef.threadId);
  const isFilesRoute = props.workspaceRouteName === "ThreadFiles";

  const filesCwd = useThreadCwd(isFilesRoute && fileInspector.supported ? selectedThreadRef : null);

  const revealsInspector =
    props.workspaceRouteName === "ThreadReview" || (isFilesRoute && filesCwd !== null);
  const [revealedInspectors, setRevealedInspectors] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  if (
    revealsInspector &&
    props.workspaceRouteKey !== undefined &&
    selectedThreadKey !== null &&
    revealedInspectors.get(props.workspaceRouteKey) !== selectedThreadKey
  ) {
    const next = new Map<string, string>();
    for (const routeKey of props.workspaceRouteKeys) {
      const revealedThreadKey = revealedInspectors.get(routeKey);
      if (revealedThreadKey !== undefined) {
        next.set(routeKey, revealedThreadKey);
      }
    }
    next.set(props.workspaceRouteKey, selectedThreadKey);
    setRevealedInspectors(next);
    setFocusedAuxiliaryPaneRole("inspector");
    setFileInspectorPreferredVisible(true);
  }
  const [workspaceInspector, setWorkspaceInspector] = useState<{
    readonly render: () => ReactNode;
    readonly active: boolean;
  } | null>(null);
  const workspaceInspectorOwner = useRef<symbol | null>(null);
  const registerWorkspaceInspector = (render: () => ReactNode) => {
    const owner = Symbol("workspace-inspector");
    workspaceInspectorOwner.current = owner;
    setWorkspaceInspector({ render, active: true });

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
  const activateAuxiliaryPaneRole = (role: WorkspaceAuxiliaryPaneRole) => {
    const owner = Symbol(role);
    activeRoleOwner.current = owner;
    setFocusedAuxiliaryPaneRole(role);

    return () => {
      if (activeRoleOwner.current !== owner) {
        return;
      }
      activeRoleOwner.current = null;
      setFocusedAuxiliaryPaneRole(null);
    };
  };
  const setPrimarySidebarVisible = (visible: boolean) => {
    if (layout.primarySidebarOverlaysContent) {
      setOverlaySidebar((current) => ({ ...current, visible }));
    } else {
      setPrimarySidebarPreferredVisible(visible);
    }
  };
  const togglePrimarySidebar = () => {
    if (primarySidebarPinned) {
      return;
    }

    if (composerKeyboardActive) {
      void KeyboardController.dismiss();
      if (primarySidebarPreferredVisible) return;
    }
    if (!panes.primarySidebarVisible && panes.primarySidebarSuppressedByAuxiliary) {
      setFileInspectorPreferredVisible(false);
      setPrimarySidebarPreferredVisible(true);
      return;
    }
    setPrimarySidebarVisible(!preferredSidebarVisible);
  };
  const revealPrimarySidebar = () => {
    if (composerKeyboardActive) void KeyboardController.dismiss();
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
  const showAuxiliaryPane = (role: WorkspaceAuxiliaryPaneRole) => {
    if (role === "inspector") {
      setFocusedAuxiliaryPaneRole("inspector");
      setFileInspectorPreferredVisible(true);
      return;
    }
    setFocusedAuxiliaryPaneRole("supplementary");
    setSupplementaryPanePreferredVisible(true);
  };
  const handleOpenFilesCommand = () => {
    const activeThread = parseActiveThreadPath(pathname);
    if (!layout.usesSplitView || !fileInspector.supported || activeThread === null) {
      return false;
    }
    showAuxiliaryPane("inspector");
    if (/\/files(?:\/|$)/.test(pathname)) {
      return true;
    }
    navigation.navigate("ThreadFiles", activeThread);
    return true;
  };
  useHardwareKeyboardCommand("files", handleOpenFilesCommand);
  const toggleAuxiliaryPane = () => {
    if (auxiliaryPaneRole === "inspector") {
      setFileInspectorPreferredVisible((current) => !current);
      return;
    }
    setSupplementaryPanePreferredVisible((current) => !current);
  };
  const setAuxiliaryPaneWidth = (nextWidth: number) => {
    if (auxiliaryPaneRole === "inspector") {
      setFileInspectorPreferredWidth(nextWidth);
      return;
    }
    setSupplementaryPanePreferredWidth(nextWidth);
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
      },
    );
    if (layout.primarySidebarOverlaysContent) {
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
      if (layout.primarySidebarOverlaysContent) setPrimarySidebarVisible(false);
      workspace?.dispatch({
        type: "select",
        tab: detail.name === "Thread" ? "threads" : "pullRequests",
      });
      startOpeningDetail(detail);
      navigation.dispatch(selectWorkspaceDetail(detail, sheet));
    });
  }
  const handleSelectThreadRoute = (params: ReactNavigation.RootParamList["Thread"]) =>
    handleSelectDetail({ name: "Thread", params });

  const projects = useProjects();
  const compactAndroidSettings =
    Platform.OS === "android" && androidSettingsOpen && !layout.usesSplitView;

  const handleStartNewTask = () => {
    const state = rootStackState(navigation);
    const currentRoute = workspaceRoutesOf(
      state?.routes.slice(0, state.index + 1) ?? [],
    ).workspace.at(-1);
    const params =
      currentRoute?.name === "Thread"
        ? (currentRoute.params as ReactNavigation.RootParamList["Thread"])
        : undefined;
    const first = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;
    const environmentId = first(params?.environmentId);
    const threadId = first(params?.threadId);

    const projectId =
      environmentId && threadId
        ? appAtomRegistry
            .get(
              environmentThreadShells.environmentThreadIndexAtom(EnvironmentId.make(environmentId)),
            )
            .get(ThreadId.make(threadId))?.projectId
        : undefined;
    const preferences = appAtomRegistry.get(mobilePreferencesAtom);
    const saved = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
    handleSelectThreadRoute(
      newTaskDestination({
        projects,
        requestId: uuidv4(),
        useLastProject: saved?.useLastProjectForNewThreads,
        currentProject: environmentId && projectId ? { environmentId, projectId } : undefined,
        lastProject: saved?.lastThreadProject,
      }),
    );
  };

  useHardwareKeyboardCommand("newTask", () => {
    handleStartNewTask();
    return true;
  });

  const handleOpenEnvironmentSettings = () => {
    openSettings(navigation, "SettingsEnvironments");
  };

  const handleOpenThreadPullRequests = useOpenThreadPullRequests();
  const { openPendingTask: handleOpenPendingTask } =
    usePendingTaskListActions(handleSelectThreadRoute);

  const handleNewThreadOnBranch = (thread: EnvironmentThreadShell) => {
    handleSelectThreadRoute({
      draft: {
        requestId: uuidv4(),
        environmentId: String(thread.environmentId),
        projectId: String(thread.projectId),
        branch: thread.branch,
        worktreePath: thread.worktreePath,
      },
    });
  };

  const handleNewThreadInProject = (project: EnvironmentProject) => {
    handleSelectThreadRoute({
      draft: {
        requestId: uuidv4(),
        environmentId: String(project.environmentId),
        projectId: String(project.id),
        title: project.title,
      },
    });
  };

  const inspectorColumnTargetWidth =
    workspaceInspector !== null && workspaceInspector.active && panes.auxiliaryPaneVisible
      ? (panes.auxiliaryPaneWidth ?? 0)
      : 0;

  const contentEndGap = Platform.OS === "android" && layout.usesSplitView ? 4 : 0;
  const contentTargetWidth = layout.usesSplitView
    ? Math.max(0, panes.contentPaneWidth - inspectorColumnTargetWidth - contentEndGap)
    : null;
  const [listPaneSizing, setListPaneSizing] = useState({
    viewportWidth,
    sidebarVisible: panes.primarySidebarVisible,
    listPaneTarget: layout.listPaneWidth,
    listPaneFloor: layout.listPaneWidth,
    listPaneCeiling: layout.listPaneWidth,
    revision: 0,
  });
  if (
    Platform.OS === "android" &&
    (listPaneSizing.viewportWidth !== viewportWidth ||
      listPaneSizing.sidebarVisible !== panes.primarySidebarVisible ||
      listPaneSizing.listPaneTarget !== layout.listPaneWidth)
  ) {
    const resizingSidebar =
      listPaneSizing.viewportWidth === viewportWidth &&
      listPaneSizing.sidebarVisible &&
      panes.primarySidebarVisible &&
      listPaneSizing.listPaneTarget !== layout.listPaneWidth;
    setListPaneSizing({
      viewportWidth,
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

  const contentLeftTarget =
    shouldRenderPrimarySidebar && panes.primarySidebarVisible
      ? (layout.listPaneWidth ?? 0) + (layout.listPaneGap ?? 0)
      : 0;
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
        if (finished && Platform.OS === "android") runOnJS(settleListPane)(listPaneRevision);
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
    listPaneRevision,
    workspacePage,
  ]);
  const railAnimatedStyle = useAnimatedStyle(() => ({ width: renderedRailWidth.value }));

  const listPaneGap = layout.listPaneGap ?? 0;
  const listPaneAnimatedStyle = useAnimatedStyle(() => ({
    width: Math.min(
      listPaneCeiling,
      Math.max(listPaneFloor, renderedSidebarWidth.value - listPaneGap),
    ),
  }));
  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    opacity:
      Platform.OS === "ios" || floatingTabsEnabled
        ? 1
        : Math.min(1, renderedSidebarWidth.value / 80),
    width: renderedSidebarWidth.value,
  }));

  const renderedInspectorWidth = useSharedValue(inspectorColumnTargetWidth);
  const renderedContentWidth = useDerivedValue(() =>
    Math.max(0, viewportWidth - renderedSidebarWidth.value - renderedInspectorWidth.value),
  );

  const handleSelectThread = (thread: EnvironmentThreadShell) => {
    handleSelectThreadRoute({
      environmentId: String(thread.environmentId),
      threadId: String(thread.id),
    });
  };

  const sidebarOverRotates =
    nativeWorkspace && nativeMetrics?.hasHinge === true && layout.usesSplitView;

  const sidebarInLandscape = baseLayout.primarySidebarOverlaysContent
    ? primarySidebarPinned || primarySidebarPreferredVisible
    : panes.primarySidebarVisible;
  const sidebarInPortrait =
    primarySidebarPinned ||
    (baseLayout.primarySidebarOverlaysContent
      ? overlaySidebar.visible
      : isWorkspaceListPath(pathname));
  const sidebarByOrientation = useMemo(
    () =>
      sidebarOverRotates ? { landscape: sidebarInLandscape, portrait: sidebarInPortrait } : null,
    [sidebarInLandscape, sidebarInPortrait, sidebarOverRotates],
  );

  const contextValue = {
    layout,
    panes,
    fileInspector,
    primarySidebarSearchQuery,
    startNewTask: handleStartNewTask,
    selectDetail: handleSelectDetail,
    activateAuxiliaryPaneRole,
    registerWorkspaceInspector,
    setPrimarySidebarSearchQuery,
    showAuxiliaryPane,
    toggleAuxiliaryPane,
    togglePrimarySidebar,
    setPrimarySidebarVisible,
    openWorkspaceTab,
    setAuxiliaryPaneWidth,
    composerKeyboardActive,
    setComposerEditing,
    sidebarByOrientation,
  };

  if (nativeWorkspace) {
    return (
      <HomeListOptionsProvider
        projectGroupingMode={projectGroupingMode}
        savedFilters={props.savedThreadListFilters}
      >
        <AdaptiveWorkspaceContext value={contextValue}>
          <NativeWorkspaceInspectorContext
            value={{ render: workspaceInspector?.render, visible: inspectorColumnTargetWidth > 0 }}
          >
            {props.children}
          </NativeWorkspaceInspectorContext>
        </AdaptiveWorkspaceContext>
      </HomeListOptionsProvider>
    );
  }
  const renderColumns = (children: ReactNode) => (
    <View
      testID="adaptive-workspace-layout"
      className={Platform.OS === "android" ? "flex-1 flex-row bg-header" : "flex-1 flex-row"}
    >
      <AndroidHingeObserver onChange={handleHingeChange} />
      {shouldRenderNavigationRail ? (
        <Animated.View className="self-stretch" style={railAnimatedStyle} />
      ) : null}
      {shouldRenderPrimarySidebar && layout.listPaneWidth !== null ? (
        <Animated.View
          className="self-stretch overflow-hidden"
          accessibilityElementsHidden={workspacePage || !panes.primarySidebarVisible}
          collapsable={false}
          importantForAccessibility={
            !workspacePage && panes.primarySidebarVisible ? "auto" : "no-hide-descendants"
          }
          pointerEvents={!workspacePage && panes.primarySidebarVisible ? "auto" : "none"}

          style={[
            workspacePage ? { position: "absolute", top: 0, bottom: 0, left: 0 } : null,
            sidebarAnimatedStyle,
          ]}
        >
          <Animated.View className="flex-1" style={listPaneAnimatedStyle}>
            <RenderErrorBoundary
              renderFallback={(fallback) => (
                <RenderFailureView
                  {...fallback}
                  title="The sidebar couldn't be displayed"
                  exit={{ label: "Open settings", onPress: handleOpenSettings }}
                />
              )}
            >
              <AndroidWorkspaceSidebar
                onRequestVisibility={revealPrimarySidebar}
                selectedPullRequestKey={props.selectedPullRequestKey ?? null}
              >
                <AndroidHomeFabLayout
                  sidebar
                  disabled={workspacePage}
                  paneWidth={layout.listPaneWidth}
                  onStartNewTask={handleStartNewTask}
                >
                  <ThreadNavigationSidebar
                    width={layout.listPaneWidth}
                    visible={panes.primarySidebarVisible}
                    onRequestVisibility={revealPrimarySidebar}
                    selectedThreadKey={selectedThreadKey}
                    onOpenSettings={handleOpenSettings}
                    onOpenEnvironmentSettings={handleOpenEnvironmentSettings}
                    onNewThreadInProject={handleNewThreadInProject}
                    onNewThreadOnBranch={handleNewThreadOnBranch}
                    onOpenPendingTask={handleOpenPendingTask}
                    onSelectThread={handleSelectThread}
                    onOpenThreadPullRequests={handleOpenThreadPullRequests}
                    onSearchQueryChange={setPrimarySidebarSearchQuery}
                    searchQuery={primarySidebarSearchQuery}
                  />
                </AndroidHomeFabLayout>
              </AndroidWorkspaceSidebar>
            </RenderErrorBoundary>
            {}
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
      <View
        className={
          Platform.OS === "android"
            ? "flex-1 overflow-hidden bg-header"
            : "flex-1 overflow-hidden bg-screen"
        }
        collapsable={false}
      >
        <View
          collapsable={false}
          style={
            contentTargetWidth !== null
              ? {
                  flex: 1,
                  width: contentTargetWidth,
                  alignSelf: contentAnchor.end ? "flex-end" : "flex-start",
                  marginRight: contentAnchor.end ? contentEndGap : 0,
                }
              : { flex: 1 }
          }
        >
          {}
          <WorkspaceContentWidthContext
            value={layout.usesSplitView && Platform.OS !== "android" ? renderedContentWidth : null}
          >
            <WorkspaceSettledContentWidthContext
              value={Platform.OS === "android" && layout.usesSplitView ? contentTargetWidth : null}
            >
              {}
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
                  <SettingsWorkspaceLayout>{children}</SettingsWorkspaceLayout>
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
        </View>
      </View>
      <WorkspaceInspectorPane
        pathname={props.pathname}
        renderedInspectorWidth={renderedInspectorWidth}
        active={workspaceInspector?.active ?? false}
        panes={panes}
        renderInspector={workspaceInspector?.render}
        setAuxiliaryPaneWidth={setAuxiliaryPaneWidth}
        onClosed={handleWorkspaceInspectorClosed}
      />
      {shouldRenderNavigationRail && navigationRailWidth > 0 ? (
        <View
          className="absolute inset-y-0 left-0"
          style={railOverlay ? { right: 0 } : { width: navigationRailWidth }}
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
      <AdaptiveWorkspaceContext.Provider value={contextValue}>
        <WindowHingeContext value={windowHinge}>
          {usesPresentationHost ? (
            <WorkspaceColumnsRendererContext value={renderColumns}>
              {props.children}
            </WorkspaceColumnsRendererContext>
          ) : (
            renderColumns(props.children)
          )}
        </WindowHingeContext>
      </AdaptiveWorkspaceContext.Provider>
    </HomeListOptionsProvider>
  );
}
