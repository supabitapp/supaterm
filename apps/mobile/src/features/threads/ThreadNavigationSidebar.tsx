import { useActiveNewTask } from "../../state/active-new-task";
import { ThreadUndoNotice } from "../home/ThreadUndoNotice";
import { useThreadListV2 } from "./useThreadListV2";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import {
  pickableProjectGroups,
  resolveScratchProjectScopeKey,
} from "@supaterm/client-runtime/state/project-grouping";
import {
  useAppearancePreferences,
  useAndroidFloatingTabs,
} from "../settings/appearance/AppearancePreferencesProvider";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import { threadSearchMatchKey } from "@supaterm/client-runtime/state/thread-search";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import Animated from "react-native-reanimated";
import { useThreadListMotion } from "./use-thread-list-motion";
import { useAtomValue } from "@effect/atom-react";
import { useMemo, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Platform, StyleSheet, View } from "react-native";
import { GestureDetector, useNativeGesture } from "react-native-gesture-handler";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { FLOATING_TABS } from "../layout/workspace/floating-workspace-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { useContentTopInset } from "../../components/ui/useBarInset";
import { scopedProjectKey, scopedThreadKey } from "../../lib/scopedEntities";
import { useProjects, useNavigationThreadShells } from "../../state/entities";
import { useThreadSearch } from "../../state/queries";
import { useThreadListV2ShelfPreferences } from "./use-thread-list-v2-shelf-preferences";
import { useThreadListNow } from "./use-thread-list-now";
import { usePendingThreadOrder } from "../../state/thread-order";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { usePendingNewTasks, type PendingNewTask } from "../../state/use-pending-new-tasks";
import { useQueuedThreadKeys } from "../../state/use-thread-outbox";
import { useWorkspaceState } from "../../state/workspace";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useThreadJumpShortcuts } from "../keyboard/threadKeyboardShortcuts";
import { requestThreadMessageJump } from "./threadMessageJump";
import { useThreadListSearchMatches } from "./useThreadListSearchMatches";
import { useHomeListOptions } from "../home/home-list-options";
import { buildHomeListFilterMenuItems } from "../home/home-list-filter-menu";
import { WorkspaceListHeader } from "../layout/workspace/WorkspaceListHeader";
import { WORKSPACE_LIST_SCROLL_INSETS } from "../layout/workspace/workspace-list-insets";
import { WorkspaceSidebarColumn } from "../layout/workspace/WorkspaceSidebarColumn";
import { buildHomeProjectScopes, findHomeProjectScope } from "../home/homeThreadList";
import { SwipeableScrollGateProvider, useSwipeableScrollGate } from "../home/thread-swipe-actions";
import { usePendingTaskListActions } from "../home/usePendingTaskListActions";
import { useThreadListActions } from "../home/useThreadListActions";
import { useFabScroll } from "../home/FabScrollContext";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import {
  ThreadListV2PendingRow,
  ThreadListV2Row,
  ThreadListV2DoneShelfHeader,
  ThreadListV2ShowMoreRow,
  ThreadListV2SnoozedShelfHeader,
  ThreadListV2PinnedShelfHeader,
  ThreadListV2ActiveShelfHeader,
  ThreadListV2GroupHeader,
  ThreadListV2WorkingShelfHeader,
} from "./thread-list-v2-items";
import { useThreadRowProviderInstanceResolver } from "./thread-provider-instance";
import type { ThreadPrPresentation } from "../../state/thread-pr-presentation";
import { ThreadPrDemandProvider } from "../../state/thread-pr-demand";
import {
  threadListV2ListItemsAreEqual,
  THREAD_LIST_V2_DONE_INITIAL_COUNT,
  THREAD_LIST_V2_DONE_PAGE_COUNT,
  type ThreadListV2ListItem,
} from "./threadListV2";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";

/** The sidebar list: flat v2 rows with queued tasks spliced in, plus a
    done "Show more" pager row. */
type SidebarListItem = ThreadListV2ListItem;

interface ThreadNavigationSidebarProps {
  readonly width: number;
  readonly visible: boolean;
  readonly selectedThreadKey: string | null;
  readonly onOpenSettings: () => void;
  readonly onOpenEnvironmentSettings: () => void;
  readonly onNewThreadOnBranch: (thread: EnvironmentThreadShell) => void;
  readonly onNewThreadInProject: (project: EnvironmentProject) => void;
  readonly onOpenPendingTask: (pendingTask: PendingNewTask) => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onOpenThreadPullRequests: (
    thread: EnvironmentThreadShell,
    pr: ThreadPrPresentation,
  ) => void;
  readonly onRequestVisibility: () => void;
  readonly searchQuery: string;
}

export function ThreadNavigationSidebar(props: ThreadNavigationSidebarProps) {
  return (
    <ThreadPrDemandProvider visible={props.visible}>
      <WorkspaceSidebarColumn width={props.width}>
        <ThreadNavigationSidebarPane {...props} />
      </WorkspaceSidebarColumn>
    </ThreadPrDemandProvider>
  );
}

function ThreadNavigationSidebarPane(props: ThreadNavigationSidebarProps) {
  const workspace = useWorkspaceTabs();
  const [initialScrollOffset] = useState(() => workspace?.getScrollOffset("threads") ?? 0);
  const floatingTabsEnabled = useAndroidFloatingTabs();
  const { themeVariables: materialTheme } = useAppearancePreferences();
  const drawerColor = materialTheme["--color-drawer"];

  const insets = useSafeAreaInsets();
  const contentTopInset = useContentTopInset();
  const { fabClearance, fabSize } = useAndroidControlSizing();
  const projects = useProjects();
  const threads = useNavigationThreadShells();
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const sidebarScrollGesture = useNativeGesture();
  const {
    archiveThread,
    confirmDeleteThread,
    markThreadDone,
    snoozeThread,
    unsnoozeThread,
    reopenThread,
    pinThread,
    unpinThread,
    setThreadAutoMarkDone,
    renameThread,
    regenerateThreadTitle,
  } = useThreadListActions();
  const pendingTasks = usePendingNewTasks();
  const activeNewTask = useActiveNewTask();
  const queuedThreadKeys = useQueuedThreadKeys();
  const selectDetail = useSelectWorkspaceDetail();
  const { confirmDeletePendingTask } = usePendingTaskListActions((params) =>
    selectDetail({ name: "Thread", params }),
  );
  const environments = Object.values(savedConnectionsById)
    .map((connection) => ({
      environmentId: connection.environmentId,
      label: connection.environmentLabel,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const availableEnvironmentIds = new Set(
    environments.map((environment) => environment.environmentId),
  );
  const {
    options,
    setSelectedEnvironmentId,
    setSelectedProjectKey,
    setThreadGrouping,
    setHideOfflineEnvironments,
  } = useHomeListOptions(availableEnvironmentIds);
  const searchEnvironmentIds =
    options.selectedEnvironmentId === null
      ? workspaceEnvironments
          .filter((environment) => environment.connectionState === "connected")
          .map((environment) => environment.environmentId)
      : workspaceEnvironments.some(
            (environment) =>
              environment.environmentId === options.selectedEnvironmentId &&
              environment.connectionState === "connected",
          )
        ? [options.selectedEnvironmentId]
        : [];
  // A legacy per-environment scratch key resolves here on every render; the stored
  // value is only rewritten when the user picks a filter.
  const resolvedProjectKey = resolveScratchProjectScopeKey(options.selectedProjectKey, projects, {
    sidebarProjectGroupingMode: options.projectGroupingMode,
    sidebarProjectGroupingOverrides: {},
  });
  const projectScopes = useMemo(
    () =>
      buildHomeProjectScopes({
        projects,
        environmentId: options.selectedEnvironmentId,
        projectGroupingMode: options.projectGroupingMode,
      }),
    [projects, options.selectedEnvironmentId, options.projectGroupingMode],
  );
  const projectFilterOptions = pickableProjectGroups(projectScopes).map((scope) => ({
    key: scope.key,
    label: scope.title,
  }));
  const projectTitleByProjectKey = useMemo(
    () =>
      new Map(
        projectScopes.flatMap((scope) =>
          scope.projectRefs.map(
            (projectRef) =>
              [
                scopedProjectKey(projectRef.environmentId, projectRef.projectId),
                scope.title,
              ] as const,
          ),
        ),
      ),
    [projectScopes],
  );
  // An archived project's filter reads as all projects, matching the filter menu.
  const selectedProjectScope =
    pickableProjectGroups(projectScopes).find((scope) => scope.key === resolvedProjectKey) ?? null;
  const threadSearch = useThreadSearch(
    searchEnvironmentIds,
    props.searchQuery,
    selectedProjectScope === null
      ? {}
      : { projectIds: selectedProjectScope.projectRefs.map((ref) => ref.projectId) },
  );
  // This map reaches LegendList's extraData, which re-renders every row whenever it changes
  // identity; the hook keeps it stable.
  const threadSearchMatchByKey = useThreadListSearchMatches(threads, threadSearch);
  const selectedProjectKey = selectedProjectScope?.key ?? null;
  const projectByKey = useMemo(() => {
    const map = new Map<string, EnvironmentProject>();
    for (const project of projects) {
      map.set(scopedProjectKey(project.environmentId, project.id), project);
    }
    return map;
  }, [projects]);

  // Thread List v2 (beta) support — same model as the compact Home list
  // (HomeScreen.tsx): flat creation-order card block + done recency tail.
  // The done tail renders in pages; expansion resets when the filter
  // context changes so environment/search flips never inherit a deep page.
  const [doneVisibleCount, setDoneVisibleCount] = useState(THREAD_LIST_V2_DONE_INITIAL_COUNT);
  const doneResetKey = `${options.selectedEnvironmentId ?? "all"}:${selectedProjectKey ?? "all"}:${props.searchQuery.trim()}`;
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
    collapsedGroups,
    toggleDoneShelf,
    toggleSnoozedShelf,
    togglePinnedShelf,
    toggleActiveShelf,
    toggleWorkingShelf,
    toggleGroup,
  } = useThreadListV2ShelfPreferences();
  const now = useThreadListNow(threads);
  const listEnvironments = useAtomValue(threadListEnvironmentsAtom);
  const {
    providersByEnvironmentId,
    machineByEnvironmentId,
    loadedEnvironmentIds,
    snoozePresetsByEnvironmentId,
  } = listEnvironments;
  const resolveProviderInstance = useThreadRowProviderInstanceResolver(providersByEnvironmentId);
  const pendingOrder = usePendingThreadOrder();
  const {
    items: listItems,
    contentOnlyThreadKeys,
    olderDoneShelf,
  } = useThreadListV2({
    grouping: options.threadGrouping,
    groupingProjects: projectScopes.map((scope) => ({
      key: scope.key,
      label: scope.title,
      memberProjectRefs: scope.projectRefs,
    })),
    threads,
    hideOfflineEnvironments: options.hideOfflineEnvironments,
    pendingTasks,
    environmentId: options.selectedEnvironmentId,
    projectRefs: selectedProjectScope === null ? null : selectedProjectScope.projectRefs,
    searchQuery: props.searchQuery,
    searchMatches: threadSearchMatchByKey,
    pendingOrder,
    queuedThreadKeys,
    loadedEnvironmentIds,
    doneLimit: doneVisibleCount,
    now,
    shelfPreferencesLoaded,
    pinnedShelfExpanded,
    activeShelfExpanded,
    workingShelfExpanded,
    collapsedGroups,
    snoozedShelfExpanded,
    doneShelfExpanded,
    selectedThreadKey: props.selectedThreadKey ?? null,
  });

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
  const { onSelectThread, onOpenThreadPullRequests } = props;
  // A row listed for a message match opens the thread at that message, by
  // tap or by shortcut.
  const handleSelectThread = (thread: EnvironmentThreadShell) => {
    const key = threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id });
    const messageId = contentOnlyThreadKeys.has(key)
      ? threadSearchMatchByKey.get(key)?.messageId
      : undefined;
    if (messageId) {
      requestThreadMessageJump(scopedThreadKey(thread.environmentId, thread.id), messageId);
    }
    onSelectThread(thread);
    openSwipeableRef.current?.close();
  };
  const handleOpenThreadPullRequests = (
    thread: EnvironmentThreadShell,
    pr: ThreadPrPresentation,
  ) => {
    onOpenThreadPullRequests(thread, pr);
    openSwipeableRef.current?.close();
  };
  const handleScrollBeginDrag = () => {
    openSwipeableRef.current?.close();
  };
  const onFabScroll = useFabScroll();
  const handleListScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onFabScroll?.(event);
    workspace?.recordScrollOffset(
      "threads",
      Math.max(0, event.nativeEvent.contentOffset.y + contentTopInset),
    );
  };
  const { swipeEnabled, scrollGateHandlers } = useSwipeableScrollGate({
    onScroll: handleListScroll,
    onScrollBeginDrag: handleScrollBeginDrag,
  });
  // Project shells and search maps feed row props, so they bust the recycler's memoization or a
  // row keeps its first blank favicon and title. The minute clock stays out: its text lives on
  // the items, so a tick re-renders only rows whose text moved.
  const listExtraData = {
    activeNewTask,
    selectedThreadKey: props.selectedThreadKey ?? "",
    projectByKey,
    projectScopes,
    projectTitleByProjectKey,
    savedConnectionsById,
    listEnvironments,
    threadSearchMatchByKey,
  };
  useThreadJumpShortcuts(listItems, handleSelectThread);
  const listMotion = useThreadListMotion({
    items: listItems,
    doneLimit: doneVisibleCount,
    scope: doneResetKey,
    searching: props.searchQuery.trim().length > 0,
    scrolling: !swipeEnabled,
    ready: shelfPreferencesLoaded,
  });
  const prepareListMotion = listMotion.prepare;
  const renderListItemContent = ({ item }: { readonly item: SidebarListItem }) => {
    switch (item.type) {
      case "v2-pending": {
        const pendingScopeKey = scopedProjectKey(
          item.pendingTask.environmentId,
          item.pendingTask.projectId,
        );
        return (
          <ThreadListV2PendingRow
            pendingTask={item.pendingTask}
            selected={
              activeNewTask?.pendingKey === item.pendingTask.key ||
              (item.pendingTask.kind === "pending" &&
                scopedThreadKey(
                  item.pendingTask.environmentId,
                  item.pendingTask.message.threadId,
                ) === props.selectedThreadKey)
            }
            project={projectByKey.get(pendingScopeKey) ?? null}
            projectTitle={projectTitleByProjectKey.get(pendingScopeKey)}
            environmentLabel={
              Object.keys(savedConnectionsById).length > 1
                ? (savedConnectionsById[item.pendingTask.environmentId]?.environmentLabel ?? null)
                : null
            }
            environmentMachine={machineByEnvironmentId.get(item.pendingTask.environmentId)}
            pane="sidebar"
            showPendingDivider={item.showPendingDivider}
            onSelectPendingTask={props.onOpenPendingTask}
            onDeletePendingTask={confirmDeletePendingTask}
            onSwipeableClose={handleSwipeableClose}
            onSwipeableWillOpen={handleSwipeableWillOpen}
            fullSwipeWidth={props.width - 20}
            simultaneousSwipeGesture={sidebarScrollGesture}
          />
        );
      }
      case "v2-thread": {
        const thread = item.item.thread;
        const scopeKey = scopedProjectKey(thread.environmentId, thread.projectId);
        return (
          <ThreadListV2Row
            onNewThreadOnBranch={props.onNewThreadOnBranch}
            thread={thread}
            variant={item.item.variant}
            hasQueuedMessages={item.hasQueuedMessages}
            snoozed={item.item.snoozed}
            pinned={item.item.pinned}
            wokeAt={item.item.wokeAt}
            snoozePresetMinute={item.snoozePresetMinute ?? ""}
            snoozeWakeLabelText={item.snoozeWakeLabelText}
            timeLabel={item.timeLabel}
            project={projectByKey.get(scopeKey) ?? null}
            showProjectIcon={item.showProjectIcon}
            providerInstance={resolveProviderInstance(thread)}
            providers={providersByEnvironmentId.get(thread.environmentId)}
            environmentLabel={
              Object.keys(savedConnectionsById).length > 1
                ? (savedConnectionsById[thread.environmentId]?.environmentLabel ?? null)
                : null
            }
            environmentMachine={machineByEnvironmentId.get(thread.environmentId)}
            searchMatch={
              // Only rows listed for their messages show one and open at it.
              contentOnlyThreadKeys.has(
                threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
              )
                ? threadSearchMatchByKey.get(
                    threadSearchMatchKey({
                      environmentId: thread.environmentId,
                      threadId: thread.id,
                    }),
                  )
                : undefined
            }
            searchQuery={threadSearch.query}
            pane="sidebar"
            selected={
              !activeNewTask &&
              scopedThreadKey(thread.environmentId, thread.id) === props.selectedThreadKey
            }
            fullSwipeWidth={props.width - 20}
            onSelectThread={handleSelectThread}
            onOpenThreadPullRequests={handleOpenThreadPullRequests}
            onDeleteThread={confirmDeleteThread}
            onArchiveThread={archiveThread}
            onRenameThread={renameThread}
            onRegenerateThreadTitle={regenerateThreadTitle}
            titleRegenerationSupported={loadedEnvironmentIds.has(thread.environmentId)}
            markDoneSupported={loadedEnvironmentIds.has(thread.environmentId)}
            onMarkThreadDone={markThreadDone}
            snoozeSupported={loadedEnvironmentIds.has(thread.environmentId)}
            snoozePresets={snoozePresetsByEnvironmentId.get(thread.environmentId)}
            pinningSupported={loadedEnvironmentIds.has(thread.environmentId)}
            autoMarkDoneOptOutSupported={loadedEnvironmentIds.has(thread.environmentId)}
            arrangeSupported={loadedEnvironmentIds.has(thread.environmentId)}
            onSnoozeThread={snoozeThread}
            onUnsnoozeThread={unsnoozeThread}
            onReopenThread={reopenThread}
            onPinThread={pinThread}
            onUnpinThread={unpinThread}
            onSetThreadAutoMarkDone={setThreadAutoMarkDone}
            onSwipeableClose={handleSwipeableClose}
            onSwipeableWillOpen={handleSwipeableWillOpen}
            simultaneousSwipeGesture={sidebarScrollGesture}
          />
        );
      }
      case "v2-group-header":
        return (
          <ThreadListV2GroupHeader
            groupKey={item.groupKey}
            label={item.label}
            project={findHomeProjectScope(projectScopes, item.projectKey)?.representative ?? null}
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={toggleGroup}
            pane="sidebar"
          />
        );
      case "v2-active-header":
        return (
          <ThreadListV2ActiveShelfHeader
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={toggleActiveShelf}
            pane="sidebar"
          />
        );
      case "v2-pinned-shelf":
        return (
          <ThreadListV2PinnedShelfHeader
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={togglePinnedShelf}
            pane="sidebar"
          />
        );
      case "v2-working-shelf":
        return (
          <ThreadListV2WorkingShelfHeader
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={toggleWorkingShelf}
            pane="sidebar"
          />
        );
      case "v2-snoozed-shelf":
        return (
          <ThreadListV2SnoozedShelfHeader
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={toggleSnoozedShelf}
            pane="sidebar"
          />
        );
      case "v2-done-shelf":
        return (
          <ThreadListV2DoneShelfHeader
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={() => {
              prepareListMotion();
              toggleDoneShelf();
            }}
            pane="sidebar"
          />
        );
      case "v2-show-more":
        return (
          <ThreadListV2ShowMoreRow
            pane="sidebar"
            hiddenCount={item.hiddenCount}
            {...(item.state === undefined ? {} : { state: item.state })}
            onPress={() => {
              olderDoneShelf.retry();
              showMoreDone();
            }}
          />
        );
    }
  };
  const renderListItem = (itemProps: Parameters<typeof renderListItemContent>[0]) => (
    <Animated.View
      key={itemProps.item.key}
      collapsable={false}
      entering={listMotion.entering}
      exiting={listMotion.exiting}
    >
      {renderListItemContent(itemProps)}
    </Animated.View>
  );
  const header = (
    <WorkspaceListHeader
      accessibilityLabel="Supaterm, Threads"
      onOpenEnvironments={props.onOpenEnvironmentSettings}
      onOpenSettings={props.onOpenSettings}
      search={{
        value: props.searchQuery,
        onChangeText: props.onSearchQueryChange,
        placeholder: "Search",
        accessibilityLabel: "Search threads",
      }}
      filter={{
        customized: options.selectedEnvironmentId !== null || selectedProjectKey !== null,
        items: buildHomeListFilterMenuItems({
          grouping: options.threadGrouping,
          onGroupingChange: setThreadGrouping,
          environments,
          projects: projectFilterOptions,
          selectedEnvironmentId: options.selectedEnvironmentId,
          selectedProjectKey,
          onEnvironmentChange: setSelectedEnvironmentId,
          onProjectChange: setSelectedProjectKey,
          hideOfflineEnvironments: options.hideOfflineEnvironments,
          onHideOfflineEnvironmentsChange: setHideOfflineEnvironments,
        }),
      }}
      sidebar={{
        width: props.width,
        visible: props.visible,
        onRequestVisibility: props.onRequestVisibility,
      }}
    />
  );
  const listEmpty = (
    <Text
      className={
        Platform.OS === "android"
          ? "px-4 py-4 text-center text-sm text-drawer-foreground-muted"
          : "px-2 py-4 text-sm text-drawer-foreground-muted"
      }
    >
      {catalogState.isLoadingConnections
        ? "Loading threads…"
        : Platform.OS === "android" && !catalogState.hasConnections
          ? "No environments connected"
          : props.searchQuery.trim().length > 0
            ? threadSearch.isPending
              ? "Searching thread messages…"
              : "No matching threads"
            : selectedProjectScope !== null
              ? `No threads in ${selectedProjectScope.title}`
              : "No threads yet"}
    </Text>
  );

  if (Platform.OS === "ios") {
    return (
      <>
        {header}
        <View className="flex-1">
          <SwipeableScrollGateProvider enabled={swipeEnabled}>
            <GestureDetector gesture={sidebarScrollGesture}>
              <AnimatedLegendList
                renderScrollComponent={NativeScrollView}
                itemLayoutAnimation={listMotion.layout}
                initialScrollOffset={
                  initialScrollOffset > 0 ? initialScrollOffset - contentTopInset : undefined
                }
                data={listItems}
                drawDistance={500}
                estimatedItemSize={64}
                extraData={listExtraData}
                getItemType={(item) => item.type}
                itemsAreEqual={threadListV2ListItemsAreEqual}
                keyExtractor={(item) => item.key}
                renderItem={renderListItem}
                {...WORKSPACE_LIST_SCROLL_INSETS}
                contentContainerStyle={[
                  styles.threadListContent,
                  {
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                    paddingTop: 6,
                  },
                ]}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                {...scrollGateHandlers}
                recycleItems
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                style={styles.threadList}
                ListEmptyComponent={listEmpty}
              />
            </GestureDetector>
          </SwipeableScrollGateProvider>
          <ThreadUndoNotice visible={props.visible} />
        </View>
      </>
    );
  }

  // Android: the bar floats below the list.
  return (
    <View testID="thread-navigation-sidebar" className="flex-1 bg-header">
      <View
        className="flex-1"
        style={{
          marginHorizontal: 4,
          paddingBottom: insets.bottom,
          backgroundColor: drawerColor,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          overflow: "hidden",
        }}
      >
        {listItems.length === 0 ? (
          <View className="flex-1 items-center justify-center">{listEmpty}</View>
        ) : (
          <SwipeableScrollGateProvider enabled={swipeEnabled}>
            <GestureDetector gesture={sidebarScrollGesture}>
              {/* oxlint-disable-next-line supaterm/require-registered-list-scroll -- The Android sidebar has no native header to register with. */}
              <AnimatedLegendList
                itemLayoutAnimation={listMotion.layout}
                initialScrollOffset={initialScrollOffset > 0 ? initialScrollOffset : undefined}
                data={listItems}
                drawDistance={500}
                estimatedItemSize={64}
                extraData={listExtraData}
                getItemType={(item) => item.type}
                itemsAreEqual={threadListV2ListItemsAreEqual}
                keyExtractor={(item) => item.key}
                renderItem={renderListItem}
                contentContainerStyle={{
                  paddingBottom: floatingTabsEnabled
                    ? FLOATING_TABS.bottom + FLOATING_TABS.edge + fabSize
                    : Math.max(insets.bottom, 16) + fabClearance - insets.bottom,
                  paddingTop: 6,
                }}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                {...scrollGateHandlers}
                recycleItems
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                style={styles.threadList}
                ListEmptyComponent={listEmpty}
              />
            </GestureDetector>
          </SwipeableScrollGateProvider>
        )}
      </View>
      {header}
      <ThreadUndoNotice visible={props.visible} />
    </View>
  );
}

const styles = StyleSheet.create({
  threadList: {
    flex: 1,
  },
  threadListContent: {
    paddingHorizontal: 8,
  },
});
