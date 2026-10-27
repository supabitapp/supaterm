import { Button } from "../../components/ui/Button";
import {
  applyPullRequestDraftFilterChange,
  parsePullRequestQuery,
} from "@supaterm/client-runtime/pull-request-query";
import { WorkspaceHeaderActions } from "../workspace/WorkspaceHeaderActions";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useNavigation } from "@react-navigation/native";
import { use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sortProjectsByGroupOrder } from "@supaterm/client-runtime/state/project-grouping";
import { useAtomValue } from "@effect/atom-react";
import {
  Keyboard,
  Platform,
  RefreshControl,
  ScrollView,
  View,
  type ScrollViewProps,
} from "react-native";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { NativeScrollViewMarker as ScrollViewMarker } from "../../native/NativeScrollViewMarker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useWorkspaceState } from "../../state/workspace";
import { useProjects } from "../../state/entities";
import { useMobileProjectGroupingSettings } from "../../state/project-grouping";
import { homeProjectOrderAtom } from "../home/homeProjectOrder";
import { environmentServerConfigsAtom } from "../../state/server";
import { PullRequestListRow } from "./PullRequestListRow";
import { PullRequestCardRow } from "./PullRequestControls";
import { createPullRequestListFilterMenu } from "./pullRequestListFilterMenu";
import { usePullRequestList } from "./usePullRequestList";
import { usePullRequestListControls } from "./usePullRequestListControls";
import { usePullRequestListActions } from "./usePullRequestListActions";
import type { WorkspaceFilterMenu } from "../workspace/workspace-filter-menu";
import {
  filterPullRequestList,
  pullRequestListFacets,
  pullRequestListInput,
  pullRequestListRowsAreEqual,
  scopedPullRequestListKey as pullRequestKey,
  type EnvironmentPullRequestListEntry,
  withoutScratchProjectScope,
} from "./pullRequestList";
import { useDebouncedValue } from "../../state/queries";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { useAndroidWorkspaceSelection } from "../workspace/useAndroidWorkspaceSelection";

function PullRequestScrollView(props: ScrollViewProps) {
  return (
    <ScrollViewMarker style={{ flex: 1 }}>
      <ScrollView {...props} />
    </ScrollViewMarker>
  );
}

function PullRequestListErrors(props: { readonly messages: readonly string[] }) {
  const [expanded, setExpanded] = useState(false);
  const title = `${props.messages.length} ${props.messages.length === 1 ? "error" : "errors"} loading pull requests`;
  return (
    <View>
      <PullRequestCardRow
        title={title}
        icon="exclamationmark.triangle"
        compact
        last
        expanded={expanded}
        accessibilityLabel={`${title}. ${expanded ? "Hide" : "Show"} details`}
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <Text selectable className="px-4 pb-3 text-sm text-foreground-muted">
          {props.messages.join("\n")}
        </Text>
      ) : null}
    </View>
  );
}

export function PullRequestsScreen(
  props: {
    readonly sidebar?: boolean;
    readonly selectedPullRequestKey?: string | null;
    /** Places the list in a frame whose header shows its filters (the Android toolbar). */
    readonly renderFrame?: PullRequestsFrameRender;
  } = {},
) {
  const navigation = useNavigation();
  const primaryColumn = use(NativePrimaryColumnContext);
  const workspace = useWorkspaceTabs()!;
  const { environments } = useWorkspaceState();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const insets = useSafeAreaInsets();
  const [initialOffset] = useState(() => workspace.getScrollOffset("pullRequests"));
  const [initialAnchor] = useState(() => workspace.getScrollAnchor("pullRequests"));
  const listRef = useRef<LegendListRef>(null);
  const tab = workspace.state.tabs.pullRequests;
  const maintainVisiblePosition = useMemo(
    () => ({
      data: tab.searchMode === "resting",
      shouldRestorePosition: () => workspace.getScrollOffset("pullRequests") > 0,
    }),
    [tab.searchMode, workspace],
  );
  const debouncedQuery = useDebouncedValue(tab.query.trim(), 180);
  const query = tab.searchMode === "resting" ? "" : debouncedQuery;
  const typedQuery = tab.searchMode === "resting" ? "" : tab.query;
  const typedDraft = parsePullRequestQuery(typedQuery).filters.draft;
  const listControls = usePullRequestListControls();
  const selectedEnvironmentId = listControls.environmentId;
  const environmentId = environments.some((item) => item.environmentId === selectedEnvironmentId)
    ? selectedEnvironmentId
    : null;
  const selectAndroidWorkspace = useAndroidWorkspaceSelection();
  const selectPullRequest = useCallback(
    (item: EnvironmentPullRequestListEntry) => {
      Keyboard.dismiss();
      const params = {
        environmentId: String(item.environmentId),
        projectId: String(item.projectId),
        repository: item.repository,
        number: item.number,
        host: item.host,
        initialSummary: item,
      };
      if (Platform.OS === "android") selectAndroidWorkspace({ name: "PullRequest", params });
      else navigation.navigate("PullRequest", params);
    },
    [navigation, selectAndroidWorkspace],
  );
  const allProjects = useProjects();
  const savedControls = listControls.controlsFor(environmentId);
  const controls = useMemo(
    () => withoutScratchProjectScope(savedControls, allProjects),
    [allProjects, savedControls],
  );
  const targets = useMemo(
    () =>
      environments
        .filter(
          (environment) =>
            configs.has(environment.environmentId) &&
            (environmentId === null || environment.environmentId === environmentId) &&
            (!controls.projectEnvironmentId ||
              environment.environmentId === controls.projectEnvironmentId),
        )
        .sort((left, right) => left.environmentId.localeCompare(right.environmentId))
        .map((environment) => ({
          environmentId: environment.environmentId,
          input: pullRequestListInput(controls, query),
        })),
    [environments, environmentId, configs, controls, query],
  );
  const result = usePullRequestList(targets);
  const connectedTargets = targets.filter((target) =>
    environments.some(
      (environment) =>
        environment.environmentId === target.environmentId &&
        environment.connectionState === "connected",
    ),
  );
  const { actions, select, busyKey } = usePullRequestListActions(
    connectedTargets.map((target) => target.environmentId),
    result.updateEntry,
  );
  const sidebar = props.sidebar === true || primaryColumn !== null;
  const selectedKey = props.selectedPullRequestKey ?? primaryColumn?.selectedPullRequestKey;
  const connectedKey = connectedTargets.map((target) => target.environmentId).join("\n");
  const entries = useMemo(
    () =>
      filterPullRequestList(
        result.entries,
        controls,
        result.data?.viewers ?? {},
        query,
        result.data.localSearchHosts,
        new Set(connectedKey.split("\n")),
      ),
    [result.entries, controls, query, result.data, connectedKey],
  );
  const facets = useMemo(() => pullRequestListFacets(result.entries), [result.entries]);
  const [knownFacets, setKnownFacets] = useState({ environmentId, source: facets, ...facets });
  if (knownFacets.environmentId !== environmentId || knownFacets.source !== facets) {
    setKnownFacets((previous) => ({
      source: facets,
      environmentId,
      authors: [
        ...new Set([
          ...(previous.environmentId === environmentId ? previous.authors : []),
          ...facets.authors,
        ]),
      ].sort(),
      labels: [
        ...new Set([
          ...(previous.environmentId === environmentId ? previous.labels : []),
          ...facets.labels,
        ]),
      ].sort(),
      labelColors: {
        ...facets.labelColors,
        ...(previous.environmentId === environmentId ? previous.labelColors : {}),
      },
    }));
  }
  const labelColors =
    knownFacets.environmentId === environmentId ? knownFacets.labelColors : facets.labelColors;
  const { sidebarProjectGroupingMode } = useMobileProjectGroupingSettings();
  const projectOrder = useAtomValue(homeProjectOrderAtom(sidebarProjectGroupingMode));
  const projects = useMemo(
    () =>
      sortProjectsByGroupOrder(
        allProjects.filter(
          (project) =>
            !project.isScratch &&
            (environmentId === null || project.environmentId === environmentId),
        ),
        projectOrder,
      ),
    [allProjects, environmentId, projectOrder],
  );
  const renderPullRequest = useCallback(
    ({ item }: { readonly item: EnvironmentPullRequestListEntry }) => (
      <PullRequestListRow
        item={item}
        onSelect={selectPullRequest}
        getActions={actions}
        onAction={select}
        busy={busyKey === pullRequestKey(item)}
        selected={selectedKey === pullRequestKey(item)}
        sidebar={sidebar}
      />
    ),
    [selectPullRequest, selectedKey, actions, select, busyKey, sidebar],
  );
  const previousSearchMode = useRef(tab.searchMode);
  useEffect(() => {
    const restoringSearch =
      previousSearchMode.current !== "resting" && tab.searchMode === "resting";
    previousSearchMode.current = tab.searchMode;
    if (restoringSearch)
      void listRef.current?.scrollToOffset({
        offset: tab.scrollOffset - (Platform.OS === "ios" ? insets.top : 0),
        animated: false,
      });
  }, [tab.searchMode, tab.scrollOffset, insets.top]);
  const initialIndex = initialAnchor
    ? entries.findIndex((entry) => pullRequestKey(entry) === initialAnchor.key)
    : -1;

  const filterMenu = createPullRequestListFilterMenu({
    environments: environments.map((item) => ({
      id: String(item.environmentId),
      label: item.environmentLabel,
    })),
    environmentId,
    onEnvironmentChange: listControls.setEnvironmentId,
    onReset: listControls.reset,
    value: typedDraft
      ? { ...controls, filters: { ...controls.filters, draft: typedDraft } }
      : controls,
    onChange: (next) => {
      const update = applyPullRequestDraftFilterChange(typedQuery, controls.filters, next.filters);
      listControls.setControls(environmentId, { ...next, filters: update.filters });
      if (update.query !== typedQuery)
        workspace.dispatch({ type: "query", tab: "pullRequests", query: update.query });
    },
    authors: knownFacets.environmentId === environmentId ? knownFacets.authors : facets.authors,
    labels: knownFacets.environmentId === environmentId ? knownFacets.labels : facets.labels,
    labelColors,
    projects,
    onSearch: (kind) =>
      navigation.navigate("PullRequestFilterSearch", {
        kind,
        environmentId,
        environmentIds: targets.map((target) => String(target.environmentId)),
        suggestions: knownFacets.environmentId === environmentId ? knownFacets[kind] : facets[kind],
        labelColors,
      }),
  });
  const headerFilterMenu = {
    ...filterMenu,
    onPressAction: (event: Parameters<typeof filterMenu.onPressAction>[0]) => {
      filterMenu.onPressAction(event);
      void listRef.current?.scrollToOffset({
        offset: Platform.OS === "ios" ? -insets.top : 0,
        animated: false,
      });
    },
  };
  const list = (
    <View className={sidebar ? "flex-1 bg-drawer" : "flex-1 bg-screen"}>
      <LegendList
        ref={listRef}
        data={entries}
        extraData={`${selectedKey}:${busyKey}`}
        keyExtractor={pullRequestKey}
        itemsAreEqual={pullRequestListRowsAreEqual}
        estimatedItemSize={88}
        drawDistance={1_000}
        maintainVisibleContentPosition={result.continued ? maintainVisiblePosition : false}
        onEndReached={() => void result.loadMore()}
        onEndReachedThreshold={0.5}
        onViewableItemsChanged={result.onViewableItemsChanged}
        refreshControl={
          <RefreshControl
            refreshing={result.refreshing}
            onRefresh={() => void result.onRefresh()}
            // The list already accounts for the navigation header in its content inset.
            progressViewOffset={Platform.OS === "ios" ? 60 : undefined}
          />
        }
        alwaysBounceVertical
        recycleItems
        renderScrollComponent={Platform.OS === "ios" ? PullRequestScrollView : undefined}
        // UIKit owns the bar's inset, so a minimizing bar and a resized column move
        // the list in the same frame as the bar.
        contentInsetAdjustmentBehavior="automatic"
        initialScrollOffset={
          !initialAnchor && initialOffset > 0
            ? initialOffset - (Platform.OS === "ios" ? insets.top : 0)
            : undefined
        }
        initialScrollIndex={
          initialIndex >= 0 && initialAnchor
            ? { index: initialIndex, viewOffset: initialAnchor.viewOffset, viewPosition: 0 }
            : undefined
        }
        contentInsetStartAdjustment={Platform.OS === "ios" ? insets.top : 0}
        contentContainerStyle={{
          paddingBottom:
            Math.max(insets.bottom, workspace.bottomClearance) -
            (Platform.OS === "ios" ? insets.bottom : 0),
        }}
        onScroll={(event) => {
          workspace.recordScrollOffset(
            "pullRequests",
            Math.max(
              0,
              event.nativeEvent.contentOffset.y + (Platform.OS === "ios" ? insets.top : 0),
            ),
          );
          const list = listRef.current?.getState();
          const item = list ? entries[list.start] : undefined;
          if (list && item)
            workspace.recordScrollAnchor("pullRequests", {
              key: pullRequestKey(item),
              viewOffset: list.positionAtIndex(list.start) - event.nativeEvent.contentOffset.y,
            });
        }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={renderPullRequest}
        ListHeaderComponent={
          <>
            {result.data?.errors.length ? (
              <PullRequestListErrors
                key={JSON.stringify(targets)}
                messages={result.data.errors.map(
                  (error) =>
                    `${error.projectTitle || environments.find((environment) => environment.environmentId === error.environmentId)?.environmentLabel || "Environment"}: ${error.message}`,
                )}
              />
            ) : null}
          </>
        }
        ListFooterComponent={
          result.loadingMore ? (
            <View className="items-center py-5">
              <AppActivityIndicator
                colorClassName="accent-icon"
                accessibilityLabel="Loading more pull requests"
              />
            </View>
          ) : result.loadMoreError ? (
            <View className="items-center gap-2 px-8 py-4">
              <Text className="text-xs text-foreground-muted">{result.loadMoreError}</Text>
              <Button
                label="Try again"
                accessibilityLabel="Retry loading more pull requests"
                onPress={() => void result.loadMore(true)}
              />
            </View>
          ) : result.hasMore ? (
            // A filtered page can be too short to scroll, which leaves nothing to reach the end of.
            <View className="items-center py-4">
              <Button
                label="Load more"
                accessibilityLabel="Load more pull requests"
                onPress={() => void result.loadMore()}
              />
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          result.isPending && connectedTargets.length > 0 ? (
            <View className="items-center py-12">
              <AppActivityIndicator colorClassName="accent-icon" />
            </View>
          ) : (
            <View className="px-8 py-12">
              <EmptyState
                title={
                  result.error
                    ? "Couldn't load pull requests"
                    : targets.length && connectedTargets.length === 0
                      ? "Environment offline"
                      : targets.length
                        ? query
                          ? "No results"
                          : "No matching pull requests"
                        : environments.length
                          ? "Pull requests unavailable"
                          : "Connect an environment"
                }
                detail={
                  result.error ??
                  (targets.length && connectedTargets.length === 0
                    ? "Reconnect to load pull requests that aren't saved on this device."
                    : targets.length
                      ? "Pull requests from the selected environments' projects appear here."
                      : environments.length
                        ? "No selected environment supports pull request browsing. Connect a supported environment or update its server."
                        : "Add an environment in Settings to browse its pull requests.")
                }
                variant="plain"
              />
            </View>
          )
        }
      />
      {Platform.OS === "ios" ? <WorkspaceHeaderActions filterMenu={headerFilterMenu} /> : null}
    </View>
  );
  return props.renderFrame ? (
    <PullRequestsFrame
      render={props.renderFrame}
      filters={Platform.OS === "android" ? headerFilterMenu : null}
      list={list}
    />
  ) : (
    list
  );
}

type PullRequestsFrameRender = (filters: WorkspaceFilterMenu | null, list: ReactNode) => ReactNode;

// Rendered as an element so the menu's press handler, which scrolls the list, is not called in render.
function PullRequestsFrame(props: {
  readonly render: PullRequestsFrameRender;
  readonly filters: WorkspaceFilterMenu | null;
  readonly list: ReactNode;
}) {
  return props.render(props.filters, props.list);
}
