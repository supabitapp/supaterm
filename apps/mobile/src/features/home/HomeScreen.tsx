import { useThreadListV2Layout } from "../threads/use-thread-list-v2-layout";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { type LegendListRef } from "@legendapp/list/react-native";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import Animated from "react-native-reanimated";
import { useThreadListMotion } from "../threads/use-thread-list-motion";
import {
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import {
  threadSearchMatchKey,
  type EnvironmentThreadSearchMatch,
} from "@supaterm/client-runtime/state/thread-search";
import { type EnvironmentId, type SidebarProjectGroupingMode } from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect } from "@react-navigation/native";
import { use, useEffect, useRef, useState, type ComponentProps, type ReactElement } from "react";
import {
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
  type ScrollViewProps,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { ScrollViewMarker } from "react-native-screens";
import { GestureDetector, useNativeGesture } from "react-native-gesture-handler";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cn } from "../../lib/cn";
import {
  ANDROID_READING_MAX_WIDTH,
  deriveCenteredContentHorizontalPadding,
} from "../../lib/layout";
import { EmptyState } from "../../components/ui/EmptyState";
import { FloatingActionButton } from "../../components/ui/FloatingActionButton";
import type { WorkspaceEnvironment, WorkspaceState } from "../../state/workspaceModel";
import type { SavedRemoteConnection } from "../../lib/connection";
import { scopedProjectKey, scopedThreadKey } from "../../lib/scopedEntities";
import {
  NativePrimaryColumnContext,
  NativeWorkspaceTabActivityContext,
} from "../../native/v5-workspace-context";
import { nativeHeaderScrollEdgeEffects } from "../../native/scrollEdgeEffects";
import {
  useNativeColumnLayoutMetrics,
  useNativeLayoutMetrics,
} from "../../native/native-layout-metrics";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import { useThreadSearch } from "../../state/queries";
import { useThreadJumpShortcuts } from "../keyboard/threadKeyboardShortcuts";
import { usePendingThreadOrder } from "../../state/thread-order";
import { threadListEnvironmentsAtom } from "../../state/server";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { useQueuedThreadKeys } from "../../state/use-thread-outbox";
import {
  ThreadListV2PendingRow,
  ThreadListV2Row,
  ThreadListV2DoneShelfHeader,
  ThreadListV2ShowMoreRow,
  ThreadListV2SnoozedShelfHeader,
  ThreadListV2PinnedShelfHeader,
  ThreadListV2ActiveShelfHeader,
  ThreadListV2WorkingShelfHeader,
} from "../threads/thread-list-v2-items";
import { useThreadRowProviderInstanceResolver } from "../threads/thread-provider-instance";
import { useOpenThreadPullRequests } from "../threads/use-open-thread-pull-requests";
import type { ThreadPrPresentation } from "../../state/thread-pr-presentation";
import {
  buildThreadListV2ListItems,
  threadListV2ListItemsAreEqual,
  THREAD_LIST_V2_DONE_INITIAL_COUNT,
  THREAD_LIST_V2_DONE_PAGE_COUNT,
  type ThreadListV2ListItem,
} from "../threads/threadListV2";
import { useThreadListV2ShelfPreferences } from "../threads/use-thread-list-v2-shelf-preferences";
import type { HomeListFilterMenuEnvironment } from "./home-list-filter-menu";
import {
  buildHomeProjectScopes,
  findHomeProjectScope,
  type HomeProjectSortOrder,
} from "./homeThreadList";
import { createSwipeRowActivation } from "./swipe-row-activation";
import { SwipeableScrollGateProvider, useSwipeableScrollGate } from "./thread-swipe-actions";
import { useFabScroll } from "./FabScrollContext";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";

interface HomeScreenProps {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  readonly catalogState: WorkspaceState;
  readonly savedConnectionsById: Readonly<Record<string, SavedRemoteConnection>>;
  readonly environments: ReadonlyArray<
    HomeListFilterMenuEnvironment & Pick<WorkspaceEnvironment, "connectionState">
  >;
  readonly searchQuery: string;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly projectSortOrder: HomeProjectSortOrder;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onAddConnection: () => void;
  readonly onOpenSettings: () => void;
  readonly onStartNewTask: () => void;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onArchiveThread: (thread: EnvironmentThreadShell) => void;
  readonly onDeleteThread: (thread: EnvironmentThreadShell) => void;
  /** Resolves true iff marking done was dispatched and succeeded. */
  readonly onMarkThreadDone: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly onSnoozeThread: (
    thread: EnvironmentThreadShell,
    snoozedUntil: string,
  ) => Promise<boolean>;
  readonly onUnsnoozeThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly onReopenThread: (thread: EnvironmentThreadShell) => void;
  readonly onPinThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly onUnpinThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly onSetThreadAutoMarkDone: (
    thread: EnvironmentThreadShell,
    enabled: boolean,
  ) => Promise<boolean>;
  readonly onRenameThread: (thread: EnvironmentThreadShell) => void;
  readonly onRegenerateThreadTitle: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly onSelectPendingTask: (pendingTask: PendingNewTask) => void;
  readonly onDeletePendingTask: (pendingTask: PendingNewTask) => void;
  readonly onNewThreadOnBranch: (thread: EnvironmentThreadShell) => void;
  readonly onNewThreadInProject: (project: EnvironmentProject) => void;
  readonly listHeader: ReactElement | undefined;
}

// v2 rows are mixed-height: done slim rows run ~60dp, single-line cards
// measured ~74dp on device (252px on the Pixel 10 Pro screenshot), two-line
// cards ~94dp. The estimate seeds the recycler's initial container count,
// `ceil((scrollLength + 2 * INITIAL_DRAW_DISTANCE) / estimate)` with the
// initial draw distance capped at 50, so an estimate at or below the average
// row height starts the pool at or above the item count for the short lists
// that LegendList otherwise keeps pooling to exactly its item count — that is
// what stopped the dev-mode "no unused container available" warning on the
// seeded short-list device passes. It is a mitigation, not an elimination:
// after first layout the full drawDistance applies, and a sudden expansion
// past the pooled headroom (~25+ items appearing at once) still creates a
// container on demand with the dev-only warning one pass ahead of the
// measured-height pool expansion. The old tallest-card estimate (~92) fired
// that warning on every ordinary shelf expand, so the average wins.
const ESTIMATED_THREAD_LIST_V2_ROW_HEIGHT = 72;
// Rows away from the viewport skip their swipe actions (see
// swipe-row-activation), so render further ahead: a fast fling then reaches
// rows that are already built instead of rows still being rebuilt.
const THREAD_LIST_V2_DRAW_DISTANCE = 1_000;

function deriveEmptyState(props: {
  readonly catalogState: WorkspaceState;
  readonly projectCount: number;
}): { readonly title: string; readonly detail: string; readonly loading: boolean } {
  const { catalogState } = props;
  if (catalogState.isLoadingConnections) {
    return {
      title: "Loading environments",
      detail: "Checking saved environments on this device.",
      loading: true,
    };
  }

  if (!catalogState.hasConnections) {
    return {
      title: "No environments connected",
      detail: "Add an environment to load projects and start coding sessions.",
      loading: false,
    };
  }

  if (
    (catalogState.connectionState === "available" ||
      catalogState.connectionState === "offline" ||
      catalogState.connectionState === "error" ||
      catalogState.connectionState === "unsupported") &&
    !catalogState.hasLoadedShellSnapshot
  ) {
    return {
      title:
        catalogState.connectionState === "unsupported"
          ? "Client not supported"
          : "Environment unavailable",
      detail:
        catalogState.connectionError ??
        "The saved environment is offline. Check the URL or start the environment, then retry.",
      loading: false,
    };
  }

  if (
    catalogState.hasConnectingEnvironment &&
    !catalogState.hasLoadedShellSnapshot &&
    catalogState.connectionError === null
  ) {
    return {
      title: "Connecting to environment",
      detail: "Loading projects and threads from the saved environment.",
      loading: true,
    };
  }

  if (props.projectCount === 0 && catalogState.hasLoadedShellSnapshot) {
    return {
      title: "No projects found",
      detail: "The connected environment did not report any projects.",
      loading: false,
    };
  }

  return {
    title: "No threads yet",
    detail: "Create a task to start a new coding runtime in one of your connected projects.",
    loading: false,
  };
}

function HomeTopContentSpacer() {
  return <View className="h-4" />;
}

function HomeScrollView(props: ComponentProps<typeof ScrollView>) {
  const insets = useSafeAreaInsets();
  const primaryColumn = use(NativePrimaryColumnContext);
  if (Platform.OS !== "ios") return <ScrollView {...props} />;

  return (
    <ScrollViewMarker
      style={{ flex: 1 }}
      scrollEdgeEffects={{
        ...nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version),

        top: Number.parseInt(String(Platform.Version), 10) >= 27 ? "automatic" : "soft",
      }}
    >
      <ScrollView
        {...props}

        className={cn(props.className, primaryColumn ? "bg-drawer" : "bg-screen")}

        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentOffset={props.contentOffset ?? { x: 0, y: -insets.top }}
      />
    </ScrollViewMarker>
  );
}

function renderHomeScrollView(props: ScrollViewProps) {
  return <HomeScrollView {...props} />;
}

export function HomeScreen(props: HomeScreenProps) {
  const tabActivity = use(NativeWorkspaceTabActivityContext);
  const usesNativeWorkspaceColumns = useNativeWorkspaceColumnsSupported();
  const workspace = useWorkspaceTabs();
  const [initialScrollOffset] = useState(() => workspace?.getScrollOffset("threads") ?? 0);
  const primaryColumn = use(NativePrimaryColumnContext);
  const contentBackground = primaryColumn ? "bg-drawer" : "bg-screen";
  const containerClassName = cn(
    "flex-1",
    Platform.OS === "android" ? "bg-header" : contentBackground,
  );
  const columnMetrics = useNativeColumnLayoutMetrics();
  const selectedThreadKey = primaryColumn?.selectedThreadKey ?? null;
  const fullSwipeWidth = primaryColumn && columnMetrics ? columnMetrics.width - 20 : undefined;
  const queuedThreadKeys = useQueuedThreadKeys();
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const homeScrollGesture = useNativeGesture();
  const insets = useSafeAreaInsets();
  const { fabClearance } = useAndroidControlSizing();
  const screenMetrics = useNativeLayoutMetrics();
  const contentSideInsets = usesNativeWorkspaceColumns
    ? (columnMetrics ?? screenMetrics)?.safeArea
    : undefined;
  // Android lists that span a wide window (foldables in portrait) keep the
  // reading width, so rows stay clear of the edges and the camera cutout.
  const { width: windowWidth } = useWindowDimensions();
  const androidListGutter =
    Platform.OS === "android"
      ? deriveCenteredContentHorizontalPadding({
          viewportWidth: windowWidth,
          maxContentWidth: ANDROID_READING_MAX_WIDTH,
          minimumPadding: 0,
        })
      : 0;
  const iosBottomClearance = Math.max(
    columnMetrics?.safeArea.bottom ?? insets.bottom,
    24,
    workspace?.bottomClearance ?? 0,
  );
  const searchEnvironmentIds =
    props.selectedEnvironmentId === null
      ? props.environments
          .filter((environment) => environment.connectionState === "connected")
          .map((environment) => environment.environmentId)
      : props.environments.some(
            (environment) =>
              environment.environmentId === props.selectedEnvironmentId &&
              environment.connectionState === "connected",
          )
        ? [props.selectedEnvironmentId]
        : [];
  const threadSearch = useThreadSearch(
    searchEnvironmentIds,
    tabActivity?.active === false ? "" : props.searchQuery,
  );
  const threadSearchMatchByKey = (() => {
    const matches = new Map<string, EnvironmentThreadSearchMatch>();
    for (const match of threadSearch.matches) {
      if (match.source === "user" || match.source === "assistant") {
        matches.set(threadSearchMatchKey(match), match);
      }
    }
    return matches;
  })();
  const matchedThreadKeys = new Set(threadSearch.matches.map(threadSearchMatchKey));
  const handleSwipeableWillOpen = (methods: SwipeableMethods) => {
    if (openSwipeableRef.current !== methods) {
      openSwipeableRef.current?.close();
      openSwipeableRef.current = methods;
    }
  };

  const handleSwipeableClose = (methods: SwipeableMethods) => {
    if (openSwipeableRef.current === methods) {
      openSwipeableRef.current = null;
    }
  };

  const handleScrollBeginDrag = () => {
    openSwipeableRef.current?.close();
  };
  const openThreadPullRequests = useOpenThreadPullRequests();
  const handleOpenThreadPullRequests = (
    thread: EnvironmentThreadShell,
    pr: ThreadPrPresentation,
  ) => {
    openSwipeableRef.current?.close();
    openThreadPullRequests(thread, pr);
  };
  const onFabScroll = useFabScroll();
  const listRef = useRef<LegendListRef>(null);
  const searchMode = workspace?.state.tabs.threads.searchMode;
  const restoredOffset = workspace?.state.tabs.threads.scrollOffset;
  useEffect(() => {
    if (searchMode !== "resting" || restoredOffset === undefined) return;
    listRef.current?.scrollToOffset({
      offset: restoredOffset - (Platform.OS === "ios" ? insets.top : 0),
      animated: false,
    });
  }, [searchMode, insets.top, restoredOffset]);
  const swipeRowActivation = createSwipeRowActivation();
  const activateVisibleRows = (rows: ReadonlyArray<ThreadListV2ListItem>) => {
    const state = listRef.current?.getState();
    if (state === undefined || !(state.end >= 0)) return;
    swipeRowActivation.activate(
      rows.slice(Math.max(0, state.start - 2), state.end + 3).map((row) => row.key),
    );
  };
  // Status-bar, accessibility and programmatic scrolls never arm the scroll
  // gate, so every scroll also activates the visible rows once it settles.
  const activationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(activationTimerRef.current), []);
  const handleListScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onFabScroll?.(event);
    if (workspace)
      workspace.recordScrollOffset(
        "threads",
        Math.max(0, event.nativeEvent.contentOffset.y + (Platform.OS === "ios" ? insets.top : 0)),
      );
    clearTimeout(activationTimerRef.current);
    activationTimerRef.current = setTimeout(
      () => activateVisibleRows(listRef.current?.getState().data ?? []),
      200,
    );
  };
  const trackListTouches = (event: GestureResponderEvent, started: boolean) => {
    const { changedTouches, touches } = event.nativeEvent;
    swipeRowActivation.trackTouches(
      started ? changedTouches.map((touch) => String(touch.identifier)) : [],
      touches.map((touch) => String(touch.identifier)),
    );
  };
  const { swipeEnabled, scrollGateHandlers } = useSwipeableScrollGate({
    onScroll: handleListScroll,
    onScrollBeginDrag: handleScrollBeginDrag,
  });

  const projectScopes = buildHomeProjectScopes({
    projects: props.projects,
    environmentId: props.selectedEnvironmentId,
    projectGroupingMode: props.projectGroupingMode,
  });
  const hasSearchQuery = props.searchQuery.trim().length > 0;
  const projectByKey = (() => {
    const map = new Map<string, EnvironmentProject>();
    for (const project of props.projects) {
      map.set(scopedProjectKey(project.environmentId, project.id), project);
    }
    return map;
  })();

  const v2ProjectScopeKey = props.selectedProjectKey;
  const v2ScopedProjectGroup = findHomeProjectScope(projectScopes, v2ProjectScopeKey);
  const v2ProjectTitleByProjectKey = new Map(
    projectScopes.flatMap((scope) =>
      scope.projectRefs.map(
        (projectRef) =>
          [scopedProjectKey(projectRef.environmentId, projectRef.projectId), scope.title] as const,
      ),
    ),
  );
  const v2ScopedProjectKeys =
    v2ScopedProjectGroup === null
      ? null
      : new Set(
          v2ScopedProjectGroup.projectRefs.map((projectRef) =>
            scopedProjectKey(projectRef.environmentId, projectRef.projectId),
          ),
        );
  // Thread List v2 (beta): one flat list in creation order, no grouping.
  // Done threads collapse into a recency tail below the card block.
  // Done threads stay in the live shell stream (done ≠ archived), so
  // the partition works directly off live shells — no snapshot merging or
  // optimistic holds.
  const handleMarkThreadDone = props.onMarkThreadDone;
  const {
    onSnoozeThread,
    onUnsnoozeThread,
    onPinThread,
    onUnpinThread,
    onSetThreadAutoMarkDone,
    onRegenerateThreadTitle,
    onRenameThread,
  } = props;
  const handleSnoozeThread = (thread: EnvironmentThreadShell, snoozedUntil: string) => {
    void onSnoozeThread(thread, snoozedUntil);
  };
  const handleUnsnoozeThread = (thread: EnvironmentThreadShell) => {
    void onUnsnoozeThread(thread);
  };
  const handlePinThread = (thread: EnvironmentThreadShell) => {
    void onPinThread(thread);
  };
  const handleUnpinThread = (thread: EnvironmentThreadShell) => {
    void onUnpinThread(thread);
  };
  const handleSetThreadAutoMarkDone = (thread: EnvironmentThreadShell, enabled: boolean) => {
    void onSetThreadAutoMarkDone(thread, enabled);
  };
  const handleRegenerateThreadTitle = (thread: EnvironmentThreadShell) => {
    void onRegenerateThreadTitle(thread);
  };
  const handleRenameThread = (thread: EnvironmentThreadShell) => onRenameThread(thread);
  const handleDeleteThread = props.onDeleteThread;
  const handleReopenThread = props.onReopenThread;
  // The done tail renders in pages; expansion resets when the filter
  // context changes so environment/search flips never inherit a deep page.
  const [doneVisibleCount, setDoneVisibleCount] = useState(THREAD_LIST_V2_DONE_INITIAL_COUNT);
  const doneResetKey = `${props.selectedEnvironmentId ?? "all"}:${v2ProjectScopeKey ?? "all"}:${props.searchQuery.trim()}`;
  const [lastDoneResetKey, setLastDoneResetKey] = useState(doneResetKey);
  if (lastDoneResetKey !== doneResetKey) {
    setLastDoneResetKey(doneResetKey);
    setDoneVisibleCount(THREAD_LIST_V2_DONE_INITIAL_COUNT);
  }
  const showMoreDone = () => setDoneVisibleCount((count) => count + THREAD_LIST_V2_DONE_PAGE_COUNT);
  const {
    loaded: shelfPreferencesLoaded,
    doneShelfExpanded,
    snoozedShelfExpanded,
    pinnedShelfExpanded,
    activeShelfExpanded,
    workingShelfExpanded,
    toggleDoneShelf,
    toggleSnoozedShelf,
    togglePinnedShelf,
    toggleActiveShelf,
    toggleWorkingShelf,
  } = useThreadListV2ShelfPreferences();
  const [nowMinute, setNowMinute] = useState(() => new Date().toISOString().slice(0, 16));
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(0);
  const [listClock, setListClock] = useState(() => ({
    nowMinute,
    snoozeWakeTick,
    now: new Date().toISOString(),
  }));
  if (listClock.nowMinute !== nowMinute || listClock.snoozeWakeTick !== snoozeWakeTick) {
    setListClock({ nowMinute, snoozeWakeTick, now: new Date().toISOString() });
  }
  useFocusEffect(() => {
    setNowMinute(new Date().toISOString().slice(0, 16));
    const id = setInterval(() => setNowMinute(new Date().toISOString().slice(0, 16)), 60_000);
    return () => clearInterval(id);
  });
  const listEnvironments = useAtomValue(threadListEnvironmentsAtom);
  const { providersByEnvironmentId, machineByEnvironmentId, loadedEnvironmentIds } =
    listEnvironments;
  const resolveProviderInstance = useThreadRowProviderInstanceResolver(providersByEnvironmentId);
  const pendingOrder = usePendingThreadOrder(nowMinute, snoozeWakeTick);
  const { threadListV2Layout } = useThreadListV2Layout({
    threads: props.threads,
    environmentId: props.selectedEnvironmentId,
    projectRefs: v2ScopedProjectGroup === null ? null : v2ScopedProjectGroup.projectRefs,
    searchQuery: props.searchQuery,
    matchedThreadKeys,
    pendingOrder,
    queuedThreadKeys,
    doneLimit: doneVisibleCount,
    now: listClock.now,
    pinnedShelfExpanded,
    activeShelfExpanded,
    workingShelfExpanded,
    snoozedShelfExpanded,
    doneShelfExpanded,
    selectedThreadKey: null,
  });
  const nextSnoozeWakeAt = threadListV2Layout.nextSnoozeWakeAt;
  useEffect(() => {
    if (nextSnoozeWakeAt === null) return;
    const wakeAtMs = Date.parse(nextSnoozeWakeAt);
    if (Number.isNaN(wakeAtMs)) return;
    const delayMs = Math.min(Math.max(0, wakeAtMs - Date.now()) + 50, 2_147_483_647);
    const id = setTimeout(() => bumpSnoozeWakeTick(snoozeWakeTick + 1), delayMs);
    return () => clearTimeout(id);
    // snoozeWakeTick must re-arm the timer even when nextSnoozeWakeAt is
    // unchanged: after a clamped fire (wake beyond the 32-bit setTimeout
    // range) the boundary string is identical and the chain would die.
  }, [nextSnoozeWakeAt, snoozeWakeTick]);
  const v2SearchQuery = props.searchQuery.trim().toLocaleLowerCase();
  const v2PendingTasks = props.pendingTasks.filter(
    (pendingTask) =>
      (props.selectedEnvironmentId === null ||
        pendingTask.environmentId === props.selectedEnvironmentId) &&
      (v2ScopedProjectKeys === null ||
        v2ScopedProjectKeys.has(
          scopedProjectKey(pendingTask.environmentId, pendingTask.projectId),
        )) &&
      (v2SearchQuery.length === 0 || pendingTask.title.toLocaleLowerCase().includes(v2SearchQuery)),
  );
  const threadListV2Items = buildThreadListV2ListItems({
    ...threadListV2Layout,
    pendingTasks: v2PendingTasks,
    pinnedShelfExpanded,
    activeShelfExpanded,
    workingShelfExpanded,
    snoozedShelfExpanded,
    doneShelfExpanded,
    snoozeLabelNow: `${nowMinute}:00.000Z`,
    loadedEnvironmentIds,
    queuedThreadKeys,
    shelfPreferencesLoading: !shelfPreferencesLoaded,
  });

  useThreadJumpShortcuts(threadListV2Items, props.onSelectThread);
  useEffect(() => {
    if (swipeEnabled) activateVisibleRows(threadListV2Items);
  }, [activateVisibleRows, swipeEnabled, threadListV2Items]);

  const listMotion = useThreadListMotion({
    items: threadListV2Items,
    doneLimit: doneVisibleCount,
    scope: doneResetKey,
    searching: hasSearchQuery,
    scrolling: !swipeEnabled,
    ready: shelfPreferencesLoaded && !props.catalogState.isLoadingConnections,
  });
  const prepareListMotion = listMotion.prepare;
  const renderV2ItemContent = ({ item }: { readonly item: ThreadListV2ListItem }) => {
    if (item.type === "v2-pending") {
      const pendingScopeKey = scopedProjectKey(
        item.pendingTask.environmentId,
        item.pendingTask.projectId,
      );
      return (
        <ThreadListV2PendingRow
          pendingTask={item.pendingTask}
          project={projectByKey.get(pendingScopeKey) ?? null}
          projectTitle={v2ProjectTitleByProjectKey.get(pendingScopeKey)}
          environmentLabel={
            Object.keys(props.savedConnectionsById).length > 1
              ? (props.savedConnectionsById[item.pendingTask.environmentId]?.environmentLabel ??
                null)
              : null
          }
          environmentMachine={machineByEnvironmentId.get(item.pendingTask.environmentId)}
          showPendingDivider={item.showPendingDivider}
          showTrailingDivider={item.showTrailingDivider}
          onSelectPendingTask={props.onSelectPendingTask}
          onDeletePendingTask={props.onDeletePendingTask}
          onSwipeableClose={handleSwipeableClose}
          onSwipeableWillOpen={handleSwipeableWillOpen}
          activationKey={item.key}
        />
      );
    }
    if (item.type === "v2-active-header") {
      return (
        <ThreadListV2ActiveShelfHeader
          count={item.count}
          disabled={item.disabled}
          expanded={item.expanded}
          onToggle={toggleActiveShelf}
        />
      );
    }
    if (item.type === "v2-show-more") {
      return <ThreadListV2ShowMoreRow hiddenCount={item.hiddenCount} onPress={showMoreDone} />;
    }
    if (item.type === "v2-pinned-shelf") {
      return (
        <ThreadListV2PinnedShelfHeader
          count={item.count}
          disabled={item.disabled}
          expanded={item.expanded}
          onToggle={togglePinnedShelf}
        />
      );
    }
    if (item.type === "v2-working-shelf") {
      return (
        <ThreadListV2WorkingShelfHeader
          count={item.count}
          disabled={item.disabled}
          expanded={item.expanded}
          onToggle={toggleWorkingShelf}
        />
      );
    }
    if (item.type === "v2-snoozed-shelf") {
      return (
        <ThreadListV2SnoozedShelfHeader
          count={item.count}
          disabled={item.disabled}
          expanded={item.expanded}
          onToggle={toggleSnoozedShelf}
        />
      );
    }
    if (item.type === "v2-done-shelf") {
      return (
        <ThreadListV2DoneShelfHeader
          count={item.count}
          disabled={item.disabled}
          expanded={item.expanded}
          onToggle={() => {
            prepareListMotion();
            toggleDoneShelf();
          }}
        />
      );
    }
    const thread = item.item.thread;
    return (
      <ThreadListV2Row
        pane={primaryColumn ? "sidebar" : "screen"}
        selected={scopedThreadKey(thread.environmentId, thread.id) === selectedThreadKey}
        fullSwipeWidth={fullSwipeWidth}
        onNewThreadOnBranch={props.onNewThreadOnBranch}
        thread={thread}
        variant={item.item.variant}
        hasQueuedMessages={item.hasQueuedMessages}
        snoozed={item.item.snoozed}
        pinned={item.item.pinned}
        snoozePresetMinute={item.snoozePresetMinute ?? ""}
        snoozeWakeLabelText={item.snoozeWakeLabelText}
        timeLabel={item.timeLabel}
        showTrailingDivider={item.showTrailingDivider}
        project={projectByKey.get(scopedProjectKey(thread.environmentId, thread.projectId)) ?? null}
        projectTitle={v2ProjectTitleByProjectKey.get(
          scopedProjectKey(thread.environmentId, thread.projectId),
        )}
        providerInstance={resolveProviderInstance(thread)}
        providers={providersByEnvironmentId.get(thread.environmentId)}
        environmentLabel={
          Object.keys(props.savedConnectionsById).length > 1
            ? (props.savedConnectionsById[thread.environmentId]?.environmentLabel ?? null)
            : null
        }
        environmentMachine={machineByEnvironmentId.get(thread.environmentId)}
        searchMatch={threadSearchMatchByKey.get(
          threadSearchMatchKey({
            environmentId: thread.environmentId,
            threadId: thread.id,
          }),
        )}
        searchQuery={props.searchQuery}
        onSelectThread={props.onSelectThread}
        onOpenThreadPullRequests={handleOpenThreadPullRequests}
        onDeleteThread={handleDeleteThread}
        onArchiveThread={props.onArchiveThread}
        onRenameThread={handleRenameThread}
        onRegenerateThreadTitle={handleRegenerateThreadTitle}
        titleRegenerationSupported={loadedEnvironmentIds.has(thread.environmentId)}
        markDoneSupported={loadedEnvironmentIds.has(thread.environmentId)}
        onMarkThreadDone={handleMarkThreadDone}
        snoozeSupported={loadedEnvironmentIds.has(thread.environmentId)}
        pinningSupported={loadedEnvironmentIds.has(thread.environmentId)}
        autoMarkDoneOptOutSupported={loadedEnvironmentIds.has(thread.environmentId)}
        arrangeSupported={loadedEnvironmentIds.has(thread.environmentId)}
        onSnoozeThread={handleSnoozeThread}
        onUnsnoozeThread={handleUnsnoozeThread}
        onReopenThread={handleReopenThread}
        onPinThread={handlePinThread}
        onUnpinThread={handleUnpinThread}
        onSetThreadAutoMarkDone={handleSetThreadAutoMarkDone}
        onSwipeableClose={handleSwipeableClose}
        onSwipeableWillOpen={handleSwipeableWillOpen}
        simultaneousSwipeGesture={homeScrollGesture}
        activationKey={item.key}
      />
    );
  };
  const v2KeyExtractor = (item: ThreadListV2ListItem) => item.key;
  const renderV2Item = (itemProps: Parameters<typeof renderV2ItemContent>[0]) => (
    <Animated.View
      key={itemProps.item.key}
      collapsable={false}
      entering={listMotion.entering}
      exiting={listMotion.exiting}
    >
      {renderV2ItemContent(itemProps)}
    </Animated.View>
  );

  // FlatList/LegendList treat a changed extraData identity as "re-render every
  // visible row", so an inline object literal would invalidate all rows on
  // every HomeScreen render — and the minute clock must stay out of it for
  // the same reason: the clock text is precomputed per item instead.
  const v2ExtraData = {
    projectByKey,
    projectTitleByProjectKey: v2ProjectTitleByProjectKey,
    listEnvironments,
    savedConnectionsById: props.savedConnectionsById,
    searchQuery: props.searchQuery,
    selectedThreadKey,
    threadSearchMatchByKey,
  };

  // The signal must ignore the search/environment filters: an active query
  // that matches nothing needs the in-list "No results" state, not the
  // full-page "No threads yet". Done threads are unarchived live shells,
  // so the archived-at check already covers the done shelf.
  const hasAnyThreads =
    props.threads.some((thread) => thread.archivedAt === null) || props.pendingTasks.length > 0;
  const selectedEnvironmentLabel =
    props.selectedEnvironmentId === null
      ? null
      : (props.savedConnectionsById[props.selectedEnvironmentId]?.environmentLabel ??
        "this environment");
  const emptyState = deriveEmptyState({
    catalogState: props.catalogState,
    projectCount: props.projects.length,
  });

  if (!hasAnyThreads) {
    return (
      <View className={containerClassName}>
        <View
          className={cn(
            "flex-1 items-center justify-center px-8",
            contentBackground,
            Platform.OS === "android" && "overflow-hidden rounded-t-[28px]",
          )}
          style={{
            paddingBottom: Platform.OS === "ios" ? iosBottomClearance : Math.max(insets.bottom, 24),
            paddingTop: NATIVE_LIQUID_GLASS_SUPPORTED ? insets.top + 72 : 0,
            paddingLeft: 32 + (contentSideInsets?.left ?? 0),
            paddingRight: 32 + (contentSideInsets?.right ?? 0),
          }}
        >
          <View className="w-full max-w-[430px]">
            <EmptyState
              title={emptyState.title}
              detail={emptyState.detail}
              actionLabel={!props.catalogState.hasReadyEnvironment ? "Add environment" : undefined}
              onAction={!props.catalogState.hasReadyEnvironment ? props.onAddConnection : undefined}
              action={
                Platform.OS === "android" && !props.catalogState.hasReadyEnvironment ? (
                  <FloatingActionButton
                    label="Add environment"
                    icon="plus"
                    variant="extended"
                    tone="primary"
                    onPress={props.onAddConnection}
                  />
                ) : undefined
              }
              variant="plain"
            />
            {emptyState.loading ? (
              <View className="mt-4 items-center">
                <AppActivityIndicator colorClassName="accent-icon-muted" />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  const v2ListEmpty =
    hasSearchQuery && threadSearch.isPending ? undefined : hasSearchQuery ? (
      <EmptyState
        title="No results"
        detail={`No threads matching "${props.searchQuery}".`}
        variant={Platform.OS === "android" ? "plain" : undefined}
      />
    ) : v2ScopedProjectGroup !== null ? (
      <EmptyState
        title={`No threads in ${v2ScopedProjectGroup.title}`}
        detail="Choose another project or create a new task."
        variant={Platform.OS === "android" ? "plain" : undefined}
      />
    ) : selectedEnvironmentLabel ? (
      <EmptyState
        title={`No threads in ${selectedEnvironmentLabel}`}
        detail="Choose another environment or create a new task."
        variant={Platform.OS === "android" ? "plain" : undefined}
      />
    ) : (
      <EmptyState
        title="No threads yet"
        detail="Create a task to start a new coding session."
        variant={Platform.OS === "android" ? "plain" : undefined}
      />
    );

  if (Platform.OS === "android" && threadListV2Items.length === 0) {
    return (
      <View className="flex-1 bg-header">
        <View
          className="flex-1 items-center justify-center overflow-hidden rounded-t-[28px] bg-screen px-4"
          style={{ paddingBottom: insets.bottom }}
        >
          {v2ListEmpty}
        </View>
      </View>
    );
  }

  return (
    <View className={containerClassName}>
      <View
        className={
          Platform.OS === "android"
            ? "flex-1 overflow-hidden rounded-t-[28px] bg-screen"
            : cn("flex-1", contentBackground)
        }
      >
        <SwipeableScrollGateProvider enabled={swipeEnabled} activation={swipeRowActivation}>
          <GestureDetector gesture={homeScrollGesture}>
            <AnimatedLegendList
              ref={listRef}
              onLoad={() => activateVisibleRows(threadListV2Items)}
              onTouchStart={(event) => trackListTouches(event, true)}
              onTouchEnd={(event) => trackListTouches(event, false)}
              onTouchCancel={(event) => trackListTouches(event, false)}
              renderScrollComponent={Platform.OS === "ios" ? renderHomeScrollView : undefined}
              data={threadListV2Items}
              renderItem={renderV2Item}
              keyExtractor={v2KeyExtractor}
              getItemType={(item) => item.type}
              itemsAreEqual={threadListV2ListItemsAreEqual}
              estimatedItemSize={ESTIMATED_THREAD_LIST_V2_ROW_HEIGHT}
              drawDistance={THREAD_LIST_V2_DRAW_DISTANCE}
              recycleItems
              itemLayoutAnimation={listMotion.layout}
              extraData={v2ExtraData}
              ListHeaderComponent={
                Platform.OS === "ios" ? props.listHeader : <HomeTopContentSpacer />
              }
              ListEmptyComponent={v2ListEmpty}
              style={{ flex: 1 }}
              automaticallyAdjustsScrollIndicatorInsets={Platform.OS === "ios"}
              contentInsetAdjustmentBehavior="never"
              contentInset={Platform.OS === "ios" ? { top: insets.top } : undefined}
              contentInsetStartAdjustment={Platform.OS === "ios" ? insets.top : 0}
              initialScrollOffset={
                initialScrollOffset > 0
                  ? initialScrollOffset - (Platform.OS === "ios" ? insets.top : 0)
                  : undefined
              }
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              {...scrollGateHandlers}
              scrollEventThrottle={16}
              contentContainerStyle={{
                paddingLeft:
                  (contentSideInsets?.left ?? 0) + (primaryColumn ? 8 : 0) + androidListGutter,
                paddingRight:
                  (contentSideInsets?.right ?? 0) + (primaryColumn ? 8 : 0) + androidListGutter,
                paddingBottom:
                  Platform.OS === "ios"
                    ? iosBottomClearance
                    : (workspace?.bottomClearance ??
                      Math.max(insets.bottom, 16) +
                        (Platform.OS === "android" ? fabClearance : 88)),
              }}
            />
          </GestureDetector>
        </SwipeableScrollGateProvider>
      </View>
    </View>
  );
}
