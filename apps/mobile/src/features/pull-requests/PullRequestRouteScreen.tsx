import { usePullRequestToolbarHeight } from "./usePullRequestToolbarHeight";
import { Chip } from "../../components/ui/Chip";
import { pullRequestTabOffset } from "./pullRequestTabScroll";
import { PullRequestGuideContent } from "./guide/PullRequestGuideScreen";
import { useReviewGuidesEnabled } from "./guide/useReviewGuide";
import {
  filterPullRequestActivity,
  DEFAULT_ACTIVITY_FILTER,
  type ActivityFilter,
} from "./pullRequestActivityFilter";
import { PullRequestActivityFilters } from "./PullRequestActivityFilters";
import type { LegendListRef } from "@legendapp/list/react-native";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import Animated from "react-native-reanimated";
import {
  PR_ROW_LAYOUT,
  PR_ROW_ENTER,
  PR_ROW_EXIT,
  PR_POSITION_LAYOUT,
} from "./pullRequestAnimations";
import {
  canPerformPullRequestAction,
  openOnProviderLabel,
  PR_ACTION_ICONS,
  pullRequestActionLabel,
} from "./pullRequestActions";
import * as Clipboard from "expo-clipboard";
import { usePullRequestPermissions } from "./usePullRequestPermissions";
import { usePullRequestDescription } from "./usePullRequestDescription";
import { usePullRequestAction } from "./usePullRequestAction";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { RegistryContext, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  type PullRequestDetail,
  type PullRequestListEntry,
  type PullRequestSummary,
} from "@supaterm/contracts";
import { PullRequestOverviewLoading } from "./PullRequestOverviewLoading";
import { copyPullRequestLink, sharePullRequestLink } from "./pullRequestLink";
import { pullRequestStatus } from "./pullRequestStatus";
import { use, useRef, useState } from "react";
import { Linking, Platform, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { AppBar } from "../../components/ui/AppBar";
import { useContentTopInset } from "../../components/ui/useBarInset";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useAndroidWorkspaceBack } from "../layout/workspace/useAndroidWorkspaceNavigation";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { RelativeTime } from "../../components/RelativeTime";
import { usePullRequestConnected } from "./usePullRequestConnected";
import { usePullRequestLiveChecks } from "./usePullRequestLiveChecks";
import { pullRequestLabelColor } from "./pullRequestList";
import { PullRequestReactions } from "./PullRequestReactions";
import { composerPullRequests } from "../../state/pull-requests";
import { useEnvironmentQuery } from "../../state/query";
import { usePullToRefresh } from "../../state/use-pull-to-refresh";
import { pullRequestTimelineRows } from "./PullRequestTimeline";
import { PullRequestActionToolbar, PullRequestCardGroup } from "./PullRequestControls";
import { pullRequestTarget as requestTarget, type PullRequestParams } from "./usePullRequestDiff";
import {
  PullRequestAvatar,
  PullRequestDiffStats,
  PullRequestReadStatus,
} from "./PullRequestPresentation";
import { usePullRequestFilesSection } from "./PullRequestFiles";
import { usePullRequestMaintainerEdits } from "./usePullRequestMaintainerEdits";
import { PullRequestDescription } from "./PullRequestDescription";
import { PullRequestMediaVisibleContext } from "./PullRequestMedia";
import { PullRequestMarkdownRepository } from "./PullRequestMarkdown";
import {
  PullRequestStatusMenu,
  PullRequestChecksRow,
  PullRequestBranchRow,
  PullRequestReviewersRow,
} from "./PullRequestStatusRows";
import { PullRequestMergeControls } from "./PullRequestMergeControls";
import { PullRequestStackCard } from "./PullRequestStackCard";
import { usePullRequestStack, type PullRequestStackState } from "./usePullRequestStack";
import { usePullRequestEnvironmentFallback } from "./usePullRequestEnvironmentFallback";
import {
  capitalizeTerm,
  sourceControlClients,
} from "@supaterm/client-runtime/source-control-clients";

function usePullRequestActivityRows(params: PullRequestParams, filter: ActivityFilter) {
  const navigation = useNavigation();
  const result = useEnvironmentQuery(composerPullRequests.activity(requestTarget(params)));
  const detail = useEnvironmentQuery(composerPullRequests.detail(requestTarget(params)));
  const permissions = usePullRequestPermissions(params, detail.data);
  const filtered = result.data ? filterPullRequestActivity(result.data, filter) : null;
  const rows = (() => {
    if (!filtered) return [];
    const rows = pullRequestTimelineRows(filtered.activity, params, navigation, {
      permissions,
      onChanged: result.refresh,
    });
    if (filter.newestFirst) {
      const notice = rows.at(-1)?.key === "truncated" ? rows.pop() : undefined;
      rows.reverse();
      if (notice) rows.push(notice);
    }
    if (!rows.length)
      rows.push({
        key: "empty",
        date: "",
        content: (
          <Text className="py-6 text-sm text-foreground-muted">
            No activity matches these filters.
          </Text>
        ),
      });
    return rows;
  })();
  return {
    rows,
    hiddenCount: filtered?.hiddenCount ?? 0,
    pending: result.isPending && !result.data,
    error: result.error,
  };
}

function PullRequestIdentity(props: {
  readonly pr: PullRequestDetail | PullRequestListEntry | PullRequestSummary;
  readonly params: PullRequestParams;
}) {
  const { pr } = props;
  const status = pullRequestStatus({ state: pr.state, isDraft: pr.isDraft === true });
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center gap-2">
        {"capabilities" in pr ? (
          <PullRequestStatusMenu pr={pr} params={props.params} />
        ) : (
          <View className="min-h-8 flex-row items-center gap-1.5">
            <SymbolView name={status.icon} size={14} tintColorClassName={status.tint} />
            <Text className={`text-xs font-supaterm-medium ${status.text}`}>{status.label}</Text>
          </View>
        )}
        <PullRequestDiffStats additions={pr.additions ?? 0} deletions={pr.deletions ?? 0} compact />
        {"changedFiles" in pr && pr.changedFiles !== undefined ? (
          <Text className="text-2xs text-foreground-muted">
            {pr.changedFiles.toLocaleString()} {pr.changedFiles === 1 ? "file" : "files"}
          </Text>
        ) : (
          <View className="h-3 w-12 rounded bg-subtle-strong" />
        )}
      </View>
      <Text selectable className="text-xl font-supaterm-bold leading-7">
        {pr.title}
      </Text>
      <View className="flex-row items-center gap-2">
        <PullRequestAvatar actor={pr.author ?? null} size={20} />
        <Text className="min-w-0 flex-1 text-xs font-supaterm-medium" numberOfLines={1}>
          {pr.author?.login ?? "Unknown author"}
        </Text>
        <Text className="shrink text-right text-2xs text-foreground-muted" numberOfLines={1}>
          Updated <RelativeTime timestamp={pr.updatedAt} /> ago
        </Text>
      </View>
      <View className="flex-row items-start gap-1.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy base branch ${pr.baseBranch}`}
          onPress={() => void Clipboard.setStringAsync(pr.baseBranch)}
          className="max-w-[50%] active:opacity-70"
          hitSlop={8}
        >
          <Text className="font-mono text-2xs text-foreground-muted">{pr.baseBranch}</Text>
        </Pressable>
        <View className="pt-0.5">
          <SymbolView name="arrow.left" size={11} tintColorClassName="accent-icon-muted" />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy head branch ${pr.headBranch}`}
          onPress={() => void Clipboard.setStringAsync(pr.headBranch)}
          className="min-w-0 shrink active:opacity-70"
          hitSlop={8}
        >
          <Text className="font-mono text-2xs text-foreground-muted">{pr.headBranch}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PullRequestLabels(props: {
  readonly pr: PullRequestDetail;
  readonly params: PullRequestParams;
}) {
  const navigation = useNavigation();
  const connected = usePullRequestConnected(props.params.environmentId);
  const canWrite = useAtomValue(
    composerPullRequests.setLabels.permissionAtom(requestTarget(props.params).environmentId),
  );
  const editable =
    connected &&
    canWrite &&
    props.pr.capabilities.labels === true &&
    props.pr.viewerPermissions.labels !== false;
  if (!props.pr.labels.length && !editable) return null;
  return (
    <Animated.View layout={PR_ROW_LAYOUT} className="flex-row flex-wrap gap-2">
      {props.pr.labels.map((label) => {
        const color = pullRequestLabelColor(label.color);
        // Tinted like the list row's label pills, at the overview's chip size.
        return (
          <View
            key={label.name}
            className="max-w-full flex-row items-center gap-1.5 rounded-2xl bg-grouped-card px-3 py-1"
            style={color ? { backgroundColor: `${color}20` } : undefined}
          >
            {color ? (
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
            ) : null}
            <Text textRole="caption" className="shrink text-foreground-muted" numberOfLines={1}>
              {label.name}
            </Text>
          </View>
        );
      })}
      {editable ? (
        <Chip
          label={props.pr.labels.length ? "Edit" : "Add labels"}
          icon="tag"
          size="small"
          accessibilityLabel="Edit labels"
          onPress={() => navigation.navigate("PullRequestLabels", props.params)}
        />
      ) : null}
    </Animated.View>
  );
}

function PullRequestOverview(props: {
  readonly pr: PullRequestDetail;
  readonly description: ReturnType<typeof usePullRequestDescription>;
  readonly params: PullRequestParams;
  readonly stack: PullRequestStackState;
  readonly onDescriptionLayout: (y: number) => void;
  readonly onDescriptionCollapse: () => void;
  readonly descriptionExpanded: boolean;
  readonly onDescriptionExpandedChange: (expanded: boolean) => void;
}) {
  const { pr } = props;
  return (
    <View className="gap-5">
      <PullRequestStackCard params={props.params} state={props.stack} />
      <PullRequestCardGroup>
        <PullRequestChecksRow pr={pr} params={props.params} />
        <PullRequestReviewersRow pr={pr} params={props.params} />
        <Animated.View layout={PR_ROW_LAYOUT}>
          <PullRequestBranchRow pr={pr} params={props.params} />
        </Animated.View>
        <Animated.View layout={PR_ROW_LAYOUT}>
          <PullRequestMergeControls pr={pr} params={props.params} stack={props.stack} />
        </Animated.View>
      </PullRequestCardGroup>
      <PullRequestLabels pr={pr} params={props.params} />
      <Animated.View
        layout={PR_POSITION_LAYOUT}
        onLayout={(event) => props.onDescriptionLayout(event.nativeEvent.layout.y)}
      >
        <PullRequestDescription
          markdown={props.description.body}
          onTaskListChange={props.description.toggleTask}
          onCollapse={props.onDescriptionCollapse}
          expanded={props.descriptionExpanded}
          onExpandedChange={props.onDescriptionExpandedChange}
          footer={<PullRequestReactions params={props.params} />}
        />
      </Animated.View>
    </View>
  );
}

export function PullRequestRouteScreen({ route }: StaticScreenProps<PullRequestParams>) {
  const returnToList = useAndroidWorkspaceBack("pullRequests");
  const { layout } = useAdaptiveWorkspaceLayout();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [toolbarHeight, setToolbarHeight] = usePullRequestToolbarHeight(insets.bottom);
  const contentTopInset = useContentTopInset();
  // Only iOS lists run under the bottom safe area; Android's floating toolbar pads its own.
  const contentBottomInset = Platform.OS === "ios" ? insets.bottom : 0;
  const params = route.params;
  usePullRequestEnvironmentFallback(params);
  const connected = usePullRequestConnected(params.environmentId);
  const [chosenSection, setSection] = useState<"overview" | "activity" | "guide">("overview");
  const requestedSection = useRef(chosenSection);
  const [listAnimationsReady, setListAnimationsReady] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const filesContent = usePullRequestFilesSection(params);
  const guidesEnabled = useReviewGuidesEnabled(params);
  // The guide tab goes away while guides are off and overview stands in. The pick is kept, so
  // guides coming back (a settings reload, a reconnect) return to the guide the user chose.
  const shown = (tab: typeof chosenSection) =>
    !guidesEnabled && tab === "guide" ? "overview" : tab;
  const section = shown(chosenSection);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>(DEFAULT_ACTIVITY_FILTER);
  const activityContent = usePullRequestActivityRows(params, activityFilter);
  const scrollOffsets = useRef<Record<string, number>>({});
  // The offset of the tab last shown, and which tab that was: a tab standing in for a hidden guide
  // has its own offset, which only its next scroll would record here.
  const currentScrollOffset = useRef<{ tab: typeof section; offset: number }>({
    tab: "overview",
    offset: -contentTopInset,
  });
  const bodyY = useRef(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollViews = useRef<Partial<Record<typeof section, LegendListRef | null>>>({});
  // AnimatedLegendList re-attaches its handle and sets state whenever its ref changes,
  // so an inline ref in the tab map loops the screen into "Maximum update depth exceeded".
  const [listRefs] = useState(() => {
    const listRef = (tab: typeof section) => (list: LegendListRef | null) => {
      scrollViews.current[tab] = list;
    };
    return {
      overview: listRef("overview"),
      guide: listRef("guide"),
      activity: listRef("activity"),
    };
  });
  const selectSection = (next: typeof section) => {
    if (next === section) return;
    const from = shown(requestedSection.current);
    const current =
      currentScrollOffset.current.tab === from
        ? currentScrollOffset.current.offset
        : (scrollOffsets.current[from] ?? -contentTopInset);
    scrollOffsets.current[section] = current;
    const headerEnd = Math.max(-contentTopInset, bodyY.current - contentTopInset);
    const offset = pullRequestTabOffset(current, scrollOffsets.current[next], headerEnd);
    requestedSection.current = next;
    scrollOffsets.current[next] = offset;
    currentScrollOffset.current = { tab: next, offset };
    scrollViews.current[next]?.scrollToOffset({ offset, animated: false });
    setSection(next);
  };
  const tabContent = activityContent;
  const filesY = useRef(0);
  const descriptionY = useRef(0);
  const pendingDescriptionJump = useRef(false);
  const pendingFilesJump = useRef(false);
  const detailAtom = composerPullRequests.detail(requestTarget(params));
  const result = useEnvironmentQuery(detailAtom);
  const pullRefresh = usePullToRefresh(detailAtom);
  const { refresh: refreshDetail } = result;
  useFocusEffect(refreshDetail);
  const pr = usePullRequestLiveChecks(params, result.data);
  const summary = params.initialSummary;
  const identity = pr ?? summary;
  const terminology = sourceControlClients.get(identity?.provider).changeRequest;
  const permissions = usePullRequestPermissions(params, pr);
  const description = usePullRequestDescription(params, pr, permissions.canEditChangeRequest);
  const action = usePullRequestAction(params, pr);
  const maintainerEdits = usePullRequestMaintainerEdits(
    params,
    pr,
    permissions.canEditMaintainerEdits,
  );
  const showsDeleteBranch = pr !== null && canPerformPullRequestAction(pr, "delete-branch");
  const stateAction = action.available("close")
    ? "close"
    : action.available("reopen")
      ? "reopen"
      : null;
  const runStateAction = () =>
    stateAction === "close" ? action.confirmClose() : void action.perform("reopen");
  const confirmDeleteBranch = () =>
    pr &&
    action.confirm(
      "delete-branch",
      pullRequestActionLabel("delete-branch", terminology),
      `Delete ${pr.headBranch} from ${pr.headRepositoryNameWithOwner ?? pr.repository}? Local branches and worktrees are not changed.`,
    );
  const stack = usePullRequestStack(params, pr);
  const refreshActivity = useAtomRefresh(composerPullRequests.activity(requestTarget(params)));
  const refreshGuide = useAtomRefresh(composerPullRequests.reviewGuide(requestTarget(params)));
  const registry = use(RegistryContext);
  const refresh = () =>
    pullRefresh.onRefresh(async (signal) => {
      const target = requestTarget(params);
      await composerPullRequests.invalidate
        .run(registry, {
          environmentId: target.environmentId,
          input: { reference: target.input },
        })
        .catch(() => undefined);
      if (signal.aborted) return;
      if (guidesEnabled) refreshGuide();
      stack.refresh();
      refreshActivity();
      filesContent.refresh();
    });
  const jumpToFiles = () => {
    scrollViews.current.overview?.scrollToIndex({
      index: 0,
      viewPosition: 0,
      viewOffset: -filesY.current,
      animated: true,
    });
    pendingFilesJump.current = false;
  };
  const openFiles = () => {
    if (section === "overview") jumpToFiles();
    else {
      pendingFilesJump.current = true;
      selectSection("overview");
      if (filesY.current > 0) requestAnimationFrame(jumpToFiles);
    }
  };
  return (
    <PullRequestMarkdownRepository params={params} changeRequest={pr}>
      <View className="flex-1 android:bg-header ios:bg-screen">
        <AppBar
          title={`#${params.number}`}
          subtitle={connected ? params.repository : `${params.repository} · Offline`}
          onBack={layout.usesSplitView ? undefined : returnToList}
          menus={[
            {
              title: `${capitalizeTerm(terminology.singular)} actions`,
              icon: "ellipsis",
              items: [
                ...(permissions.verdicts.length
                  ? [
                      {
                        id: "submit-review",
                        title: "Submit review",
                        icon: "text.bubble",
                        onPress: () =>
                          navigation.navigate("PullRequestReview", { ...params, mode: "review" }),
                      },
                    ]
                  : []),
                ...(permissions.canComment
                  ? [
                      {
                        id: "add-comment",
                        title: "Add comment",
                        icon: "plus.bubble",
                        onPress: () =>
                          navigation.navigate("PullRequestReview", { ...params, mode: "comment" }),
                      },
                    ]
                  : []),
                ...(permissions.canEditChangeRequest
                  ? [
                      {
                        id: "edit-title",
                        title: "Edit title",
                        icon: "pencil",
                        onPress: () =>
                          navigation.navigate("PullRequestEdit", { ...params, field: "title" }),
                      },
                      {
                        id: "edit-description",
                        title: "Edit description",
                        icon: "doc.text",
                        disabled: description.pending,
                        subtitle: description.pending ? "Saving…" : undefined,
                        onPress: () =>
                          navigation.navigate("PullRequestEdit", { ...params, field: "body" }),
                      },
                    ]
                  : []),
                ...(maintainerEdits.visible
                  ? [
                      {
                        id: "maintainer-edits",
                        title: "Allow edits from maintainers",
                        icon: "pencil",
                        selected: maintainerEdits.value,
                        disabled: maintainerEdits.saving,
                        subtitle: maintainerEdits.subtitle,
                        onPress: maintainerEdits.toggle,
                      },
                    ]
                  : []),
                ...(identity
                  ? [
                      {
                        id: "open-on-provider",
                        title: openOnProviderLabel(identity.provider),
                        icon: "arrow.up.right",
                        onPress: () => void Linking.openURL(identity.url),
                      },
                      {
                        id: "copy-link",
                        title: "Copy link",
                        icon: "link",
                        onPress: () => copyPullRequestLink(identity),
                      },
                      {
                        id: "share",
                        title: "Share…",
                        icon: "square.and.arrow.up",
                        onPress: () => sharePullRequestLink(identity),
                      },
                    ]
                  : []),
                ...(stateAction
                  ? [
                      {
                        id: "state",
                        title: pullRequestActionLabel(stateAction, terminology),
                        icon: PR_ACTION_ICONS[stateAction],
                        destructive: stateAction === "close",
                        onPress: runStateAction,
                      },
                    ]
                  : []),
                ...(showsDeleteBranch
                  ? [
                      {
                        id: "delete-branch",
                        title: pullRequestActionLabel("delete-branch", terminology),
                        icon: PR_ACTION_ICONS["delete-branch"],
                        destructive: true,
                        disabled: !action.available("delete-branch"),
                        subtitle: action.busy
                          ? "Deleting…"
                          : connected
                            ? pr.headBranch
                            : "Reconnect to delete this branch.",
                        onPress: confirmDeleteBranch,
                      },
                    ]
                  : []),
              ],
            },
          ]}
        />
        <ScreenContent onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}>
          {/* oxlint-disable-next-line array-guardrails/no-array-filter-map -- Three tabs. */}
          {(["overview", "guide", "activity"] as const)
            .filter((tab) => tab !== "guide" || guidesEnabled)
            .map((tab) => (
              <View
                key={tab}
                style={[StyleSheet.absoluteFill, { opacity: section === tab ? 1 : 0 }]}
                pointerEvents={section === tab ? "auto" : "none"}
                accessibilityElementsHidden={section !== tab}
                importantForAccessibility={section === tab ? "auto" : "no-hide-descendants"}
              >
                <AnimatedLegendList
                  ref={listRefs[tab]}
                  // The scroll view owns its resting offset. LegendList keeps the first
                  // initialScrollOffset it gets, and the first render has the window's top
                  // inset (0 on the folded iPhone Duo), not the header's.
                  onScroll={(event) => {
                    const offset = event.nativeEvent.contentOffset.y;
                    scrollOffsets.current[tab] = offset;
                    if (shown(requestedSection.current) === tab)
                      currentScrollOffset.current = { tab, offset };
                  }}
                  className="flex-1"
                  renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
                  contentInsetAdjustmentBehavior="never"
                  contentInset={
                    Platform.OS === "ios"
                      ? { top: contentTopInset, bottom: contentBottomInset }
                      : undefined
                  }
                  refreshControl={
                    <RefreshControl
                      refreshing={section === tab && pullRefresh.refreshing}
                      onRefresh={refresh}
                    />
                  }
                  alwaysBounceVertical
                  scrollsToTop={section === tab}
                  onItemSizeChanged={({ itemKey }) => {
                    if (
                      tab !== "overview" ||
                      section !== "overview" ||
                      itemKey !== "overview:body" ||
                      !pendingDescriptionJump.current
                    )
                      return;
                    pendingDescriptionJump.current = false;
                    scrollViews.current.overview?.scrollToIndex({
                      index: 0,
                      viewPosition: 0,
                      viewOffset: -descriptionY.current,
                      animated: false,
                    });
                  }}
                  contentContainerStyle={{
                    paddingHorizontal: 16,
                    paddingTop: 8,
                    paddingBottom: 24 + (Platform.OS === "android" ? toolbarHeight : 0),
                    // Short tabs must still be tall enough to preserve the collapsed header.
                    minHeight: Math.max(
                      0,
                      viewportHeight + headerHeight - contentTopInset - contentBottomInset,
                    ),
                  }}
                  data={[
                    {
                      key: `${tab}:body`,
                      content: (
                        <View>
                          {tab === "overview" && identity ? (
                            <View>
                              {pr ? (
                                <PullRequestOverview
                                  pr={pr}
                                  description={description}
                                  params={params}
                                  stack={stack}
                                  descriptionExpanded={descriptionExpanded}
                                  onDescriptionExpandedChange={setDescriptionExpanded}
                                  onDescriptionLayout={(y) => {
                                    descriptionY.current = y;
                                  }}
                                  onDescriptionCollapse={() => {
                                    pendingDescriptionJump.current = true;
                                  }}
                                />
                              ) : summary ? (
                                <PullRequestOverviewLoading
                                  summary={summary}
                                  params={params}
                                  stack={stack}
                                />
                              ) : null}
                              <View
                                className="mt-8 border-t border-border-subtle pt-3"
                                onLayout={(event) => {
                                  filesY.current = event.nativeEvent.layout.y;
                                  if (pendingFilesJump.current) {
                                    requestAnimationFrame(() => {
                                      if (shown(requestedSection.current) === "overview")
                                        jumpToFiles();
                                    });
                                  }
                                }}
                              >
                                {filesContent.header}
                              </View>
                            </View>
                          ) : null}
                          {tab === "guide" ? (
                            <PullRequestGuideContent
                              params={params}
                              visible={section === "guide"}
                            />
                          ) : null}
                          {tab === "activity" ? (
                            <PullRequestActivityFilters
                              value={activityFilter}
                              onChange={setActivityFilter}
                              hiddenCount={tabContent.hiddenCount}
                            />
                          ) : null}
                          {tab === "activity" ? (
                            <PullRequestReadStatus
                              pending={tabContent.pending}
                              error={tabContent.error}
                              terminology={terminology}
                            />
                          ) : null}
                        </View>
                      ),
                    },
                    ...(tab === "overview"
                      ? identity
                        ? filesContent.rows
                        : []
                      : tab === "activity"
                        ? tabContent.rows
                        : []
                    ).map((row) => ({
                      ...row,
                      key: `${tab}:${row.key}`,
                      content: row.content,
                    })),
                  ]}
                  keyExtractor={(row) => row.key}
                  getItemType={(row) =>
                    row.key.endsWith(":body") ? row.key : row.key.split(":")[0]
                  }
                  // Animating overview fights clipped markdown and collapse scroll correction; file rows can still fade.
                  itemLayoutAnimation={tab === "overview" ? undefined : PR_ROW_LAYOUT}
                  onLoad={() => setListAnimationsReady(true)}
                  renderItem={({ item }) => (
                    <Animated.View
                      key={item.key}
                      entering={
                        listAnimationsReady && !item.key.endsWith(":body")
                          ? PR_ROW_ENTER
                          : undefined
                      }
                      exiting={
                        listAnimationsReady && !item.key.endsWith(":body") ? PR_ROW_EXIT : undefined
                      }
                    >
                      <PullRequestMediaVisibleContext value={section === tab}>
                        {item.content}
                      </PullRequestMediaVisibleContext>
                    </Animated.View>
                  )}
                  recycleItems={false}
                  estimatedItemSize={tab === "overview" ? 64 : 220}
                  maintainVisibleContentPosition={false}
                  ListHeaderComponent={
                    <>
                      <PullRequestReadStatus
                        pending={result.isPending && !identity}
                        error={result.error}
                        terminology={terminology}
                      />
                      {identity ? (
                        <View
                          className="gap-5 pb-5"
                          onLayout={(event) => {
                            bodyY.current = event.nativeEvent.layout.height;
                            setHeaderHeight(event.nativeEvent.layout.height);
                          }}
                        >
                          <PullRequestIdentity pr={identity} params={params} />
                          {/* UIKit draws the tapped control's glass lens outside the hidden
                              tab's opacity, so only the visible tab mounts the control. */}
                          {Platform.OS !== "ios" || section === tab ? (
                            <SegmentedControl
                              options={[
                                { value: "overview", label: "Overview" },
                                ...(guidesEnabled
                                  ? [{ value: "guide" as const, label: "Guide" }]
                                  : []),
                                { value: "activity", label: "Activity" },
                              ]}
                              selected={section}
                              onSelect={selectSection}
                              role="tab"
                              size="compact"
                            />
                          ) : (
                            <View style={{ height: 32 }} />
                          )}
                        </View>
                      ) : null}
                    </>
                  }
                  ListFooterComponent={tab === "overview" ? filesContent.footer : null}
                />
              </View>
            ))}
        </ScreenContent>
        <PullRequestActionToolbar
          pr={pr}
          params={params}
          onOpenFiles={openFiles}
          onHeightChange={setToolbarHeight}
        />
      </View>
    </PullRequestMarkdownRepository>
  );
}
