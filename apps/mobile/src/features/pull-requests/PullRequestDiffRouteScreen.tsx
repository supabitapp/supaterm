import { Toolbar } from "../../components/ui/Toolbar";
import { guideFocusedRows, type GuideDiffFocus } from "./guide/guideDiffFocus";

import * as Clipboard from "expo-clipboard";
import { Menu } from "../../components/ui/Menu";
import { IconButton } from "../../components/ui/IconButton";
import { Button } from "../../components/ui/Button";
import { usePullRequestReviewDraft } from "./usePullRequestReviewDraft";
import { usePullRequestFilesViewed } from "./usePullRequestFilesViewed";
import { usePullRequestPermissions } from "./usePullRequestPermissions";
import { annotatePullRequestDiff, reviewPosition } from "./pullRequestDiffComments";
import { usePullRequestFileFilter } from "./usePullRequestFileFilter";
import {
  handlePullRequestDiffDebugEvent,
  pullRequestDiffInitialPosition,
} from "./pullRequestDiffDebug";
import { usePullRequestDiffHighlightFiles } from "./usePullRequestDiffHighlightFiles";
import { isPullRequestTestFile } from "./pullRequestFileFilters";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { pullRequestReviewKey } from "./pullRequestReviewDrafts";

import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";

import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";

import { EmptyState } from "../../components/ui/EmptyState";

import { NativeStackScreenOptions } from "../../native/StackHeader";

import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import { composerPullRequests } from "../../state/pull-requests";
import { useEnvironmentQuery } from "../../state/query";

import {
  resolveNativeReviewDiffView,
  type NativeReviewDiffViewHandle,
  type NativeReviewDiffViewProps,
} from "../diffs/nativeReviewDiffSurface";
import {
  getCachedNativeReviewDiffData,
  NATIVE_REVIEW_DIFF_CONTENT_WIDTH,
} from "../review/nativeReviewDiffAdapter";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useAppearanceCodeSurface } from "../settings/appearance/useAppearanceCodeSurface";
import { useNativeReviewDiffBridge } from "../review/useNativeReviewDiffBridge";

import { PullRequestActionToolbar } from "./PullRequestControls";
import {
  pullRequestTarget as requestTarget,
  usePullRequestDiff,
  usePullRequestDiffEntry,
  type PullRequestDiffParams,
} from "./usePullRequestDiff";
import { PullRequestReadStatus } from "./PullRequestPresentation";
export { PullRequestFilesSheet as PullRequestFilesRouteScreen } from "./PullRequestFiles";

import { usePullRequestToolbarHeight } from "./usePullRequestToolbarHeight";

const EMPTY_IDS: readonly string[] = [];

type PullRequestFileRouteProps = StaticScreenProps<
  PullRequestDiffParams & {
    readonly path: string;
    readonly fileSelectionId?: string;
    readonly replacingDraftId?: string;
    readonly focus?: GuideDiffFocus;
  }
>;

export function PullRequestFileRouteScreen(props: PullRequestFileRouteProps) {
  const navigation =
    useNavigation<NativeStackNavigationProp<ReactNavigation.RootParamList, "PullRequestFile">>();
  const ready = usePullRequestDiffEntry(navigation);
  if (ready) return <PullRequestFileRouteContent {...props} />;
  const title = props.route.params.commit ? "Commit changes" : "Changes";
  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions options={{ title, headerTitle: title }} />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title={title} onBack={() => navigation.goBack()} />
      ) : null}
      <View className="flex-1 items-center justify-center">
        <AppActivityIndicator accessibilityLabel="Loading changes" />
      </View>
    </View>
  );
}

function PullRequestFileRouteContent({ route }: PullRequestFileRouteProps) {
  const { layout } = useAdaptiveWorkspaceLayout();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [toolbarHeight, setToolbarHeight] = usePullRequestToolbarHeight(insets.bottom);
  const commit = route.params.commit;
  const detail = useEnvironmentQuery(composerPullRequests.detail(requestTarget(route.params)));
  const terminology = sourceControlClients.get(
    (detail.data ?? route.params.initialSummary)?.provider,
  ).changeRequest;
  const result = usePullRequestDiff(route.params, terminology);
  const filter = usePullRequestFileFilter(
    result.parsed,
    route.params.focus ? route.params.path : undefined,
  );
  const { refresh: refreshDetail } = detail;
  useFocusEffect(() => refreshDetail());
  const { loadMore } = result;
  const parsed = filter.parsed;
  const reviewDraft = usePullRequestReviewDraft(route.params);
  const viewed = usePullRequestFilesViewed(route.params, commit ? null : detail.data);
  const [commitViewedPaths, setCommitViewedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const permissions = usePullRequestPermissions(route.params, detail.data);
  const scopeKey = pullRequestReviewKey(route.params);
  const [diffHead, setDiffHead] = useState({ scopeKey, sha: detail.data?.headSha ?? null });
  if (diffHead.scopeKey !== scopeKey || (!diffHead.sha && detail.data?.headSha))
    setDiffHead({ scopeKey, sha: detail.data?.headSha ?? null });
  const staleDiff = Boolean(
    !commit && diffHead.sha && detail.data?.headSha && diffHead.sha !== detail.data.headSha,
  );
  const canCommentOnDiff =
    permissions.canInlineComment &&
    !commit &&
    !staleDiff &&
    !detail.isPending &&
    !result.isPending &&
    !result.error;
  const activity = useEnvironmentQuery(composerPullRequests.activity(requestTarget(route.params)));
  const baseData = useMemo(() => getCachedNativeReviewDiffData({ parsedDiff: parsed }), [parsed]);
  const highlightFiles = usePullRequestDiffHighlightFiles(route.params, parsed, baseData.files);
  const data = useMemo(
    () =>
      annotatePullRequestDiff(
        { ...baseData, files: highlightFiles },
        staleDiff || commit ? [] : (activity.data?.reviewThreads ?? []),
        commit ? [] : reviewDraft.draft.comments,
        diffHead.sha ?? undefined,
      ),
    [
      baseData,
      highlightFiles,
      staleDiff,
      commit,
      activity.data?.reviewThreads,
      reviewDraft.draft.comments,
      diffHead.sha,
    ],
  );
  const viewedIds = data.files
    .filter((file) => (commit ? commitViewedPaths.has(file.path) : viewed.isViewed(file.path)))
    .map((file) => file.id);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const selectedRow = data.rows.find((row) => row.id === selectedRowId);
  const selectedFile = data.files.find((file) => file.id === selectedRow?.fileId);
  const commentOnLine = (rowId = selectedRowId) => {
    const row = data.rows.find((row) => row.id === rowId);
    const file = data.files.find((file) => file.id === row?.fileId);
    if (!row || !file || !diffHead.sha || !canCommentOnDiff) return;
    const position = reviewPosition(row);
    if (!position) return;
    const oldPath =
      parsed.kind === "files"
        ? parsed.files.find((entry) => entry.id === file.id)?.previousPath
        : null;
    if (route.params.replacingDraftId) navigation.setParams({ replacingDraftId: undefined });
    navigation.navigate("PullRequestInlineComment", {
      ...route.params,
      ...(route.params.replacingDraftId ? { draftId: route.params.replacingDraftId } : {}),
      path: file.path,
      ...(oldPath ? { oldPath } : {}),
      position,
      headSha: diffHead.sha,
      code: row.content ?? "",
    });
  };
  const [jumpPath, setJumpPath] = useState(route.params.path);
  const requestedFile =
    result.parsed.kind === "files"
      ? result.parsed.files.find((file) => file.path === jumpPath)
      : undefined;
  const targetFile =
    data.files.find((file) => file.path === jumpPath) ??
    (!jumpPath || requestedFile ? data.files[0] : undefined);
  const focus = route.params.focus;
  const focusedRows = guideFocusedRows(data.rows, targetFile?.id, focus);
  const focusIndex = focusedRows.length
    ? data.rows.findIndex((row) => row.id === focusedRows[0]?.id)
    : -1;
  const [collapsedIds, setCollapsedIds] = useState<readonly string[]>(EMPTY_IDS);
  const [visibleFileId, setVisibleFileId] = useState<string | null>(null);
  const nativeView = useRef<NativeReviewDiffViewHandle>(null);
  // Native applies the entry destination before its first viewport. Imperative
  // jumps below are for subsequent selections and filter changes only.
  const jumpStarted = useRef(true);
  const lastSelection = useRef({ path: route.params.path, id: route.params.fileSelectionId });
  // Each sheet selection jumps in this reader, including reselecting its original file.
  useEffect(() => {
    if (
      lastSelection.current.path === route.params.path &&
      lastSelection.current.id === route.params.fileSelectionId
    )
      return;
    lastSelection.current = { path: route.params.path, id: route.params.fileSelectionId };
    if (route.params.focus) navigation.setParams({ focus: undefined });
    setJumpPath(route.params.path);
    setSelectedRowId(null);
    jumpStarted.current = false;
    const file = data.files.find((entry) => entry.path === route.params.path);
    if (!file || !nativeView.current) return;
    setCollapsedIds((ids) => ids.filter((id) => id !== file.id));
    jumpStarted.current = true;
    void nativeView.current.scrollToFile(file.id, false).catch(() => {
      jumpStarted.current = false;
    });
  }, [
    route.params.path,
    route.params.fileSelectionId,
    route.params.focus,
    data.files,
    navigation,
    setCollapsedIds,
    lastSelection,
    nativeView,
  ]);
  const appliedFilter = useRef(filter.hideTestFiles);
  useEffect(() => {
    if (appliedFilter.current === filter.hideTestFiles) return;
    appliedFilter.current = filter.hideTestFiles;
    if (
      result.parsed.kind === "files" &&
      result.parsed.files.some((file) => isPullRequestTestFile(file.path))
    ) {
      jumpStarted.current = false;
    }
  }, [filter.hideTestFiles, result.parsed]);
  const { nativeReviewDiffStyle } = useAppearanceCodeSurface();
  const { themeAppearance, appearance, setCodeWordBreak } = useAppearancePreferences();
  const bridge = useNativeReviewDiffBridge({
    threadKey: null,
    sectionId: `pull-request:${route.params.repository}:${route.params.number}:${commit ?? "all"}`,
    diff: result.patch,
    data,
    collapsedFileIds: collapsedIds,
    viewedFileIds: viewedIds,
    selectedRowIds: selectedRowId ? [selectedRowId] : focusedRows.map((row) => row.id),
    canHighlight: true,
  });
  const [NativeDiffView] = useState(() => resolveNativeReviewDiffView());
  // A file picked from a later page must be fetched before we can jump to its header.
  useEffect(() => {
    if (!targetFile) loadMore();
  }, [targetFile, loadMore]);
  const onDebug = ((event) =>
    handlePullRequestDiffDebugEvent(event, {
      rowCount: data.rows.length,
      targetFileId: targetFile?.id,
      focusIndex,
      isIos: Platform.OS === "ios",
      nativeView,
      jumpStarted,
      onDebug: bridge.onDebug,
      loadMore,
    })) satisfies NonNullable<NativeReviewDiffViewProps["onDebug"]>;
  const onToggleFile = ((event) => {
    const id = event.nativeEvent.fileId;
    if (!id) return;
    setCollapsedIds((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  }) satisfies NonNullable<NativeReviewDiffViewProps["onToggleFile"]>;
  const visibleFile = data.files.find((file) => file.id === visibleFileId) ?? targetFile;
  const toggleTestFiles = () => {
    setJumpPath(visibleFile?.path ?? route.params.path);
    setSelectedRowId(null);
    filter.toggle();
  };
  const title = commit ? "Commit changes" : "Changes";
  const seekingFile = !targetFile && result.nextCursor !== null;
  const loadingDiff = (result.isPending && !data.rows.length) || (seekingFile && !result.error);
  return (
    <View className={Platform.OS === "android" ? "flex-1 bg-header" : "flex-1 bg-screen"}>
      <NativeStackScreenOptions
        options={{
          title,
          headerTitle: title,
          unstable_headerSubtitle: `${commit ? commit.slice(0, 7) : `#${route.params.number}`} · ${data.files.length} ${data.files.length === 1 ? "file" : "files"}${filter.hideTestFiles && filter.hiddenCount ? ` · ${filter.hiddenCount} ${filter.hiddenCount === 1 ? "test" : "tests"} hidden` : ""}`,
        }}
      />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          title={title}
          onBack={() => navigation.goBack()}
          trailing={
            <Menu
              actions={[
                {
                  id: "word-wrap",
                  title: "Word wrap",
                  image: "text.alignleft",
                  state: appearance.codeWordBreak ? "on" : "off",
                },
                {
                  id: "hide-tests",
                  title: "Hide test files",
                  image: "line.3.horizontal.decrease",
                  state: filter.hideTestFiles ? "on" : "off",
                },
                ...(permissions.verdicts.length
                  ? [{ id: "submit-review", title: "Submit review", image: "text.bubble" }]
                  : []),
                ...(permissions.canComment
                  ? [{ id: "comment-on-pr", title: "Add comment", image: "plus.bubble" }]
                  : []),
                ...(selectedRow && selectedFile
                  ? [
                      ...(canCommentOnDiff ? [{ id: "comment", title: "Add review comment" }] : []),
                      { id: "copy", title: "Copy line" },
                    ]
                  : []),
              ]}
              onPressAction={({ nativeEvent }) => {
                if (nativeEvent.event === "word-wrap") setCodeWordBreak(!appearance.codeWordBreak);
                else if (nativeEvent.event === "hide-tests") toggleTestFiles();
                else if (
                  nativeEvent.event === "submit-review" ||
                  nativeEvent.event === "comment-on-pr"
                )
                  navigation.navigate("PullRequestReview", {
                    ...route.params,
                    mode: nativeEvent.event === "submit-review" ? "review" : "comment",
                  });
                else if (nativeEvent.event === "comment") commentOnLine();
                else void Clipboard.setStringAsync(selectedRow?.content ?? "");
              }}
            >
              <View pointerEvents="none">
                <IconButton icon="ellipsis" accessibilityLabel="Diff options" />
              </View>
            </Menu>
          }
        />
      ) : null}
      <Toolbar placement="right">
        <Toolbar.Menu title="Diff options" accessibilityLabel="Diff options" icon="ellipsis">
          {permissions.verdicts.length ? (
            <Toolbar.MenuAction
              icon="text.bubble"
              onPress={() =>
                navigation.navigate("PullRequestReview", { ...route.params, mode: "review" })
              }
            >
              <Toolbar.Label>Submit review</Toolbar.Label>
            </Toolbar.MenuAction>
          ) : null}
          {permissions.canComment ? (
            <Toolbar.MenuAction
              icon="plus.bubble"
              onPress={() =>
                navigation.navigate("PullRequestReview", { ...route.params, mode: "comment" })
              }
            >
              <Toolbar.Label>Add comment</Toolbar.Label>
            </Toolbar.MenuAction>
          ) : null}
          <Toolbar.MenuAction
            icon="text.alignleft"
            isOn={appearance.codeWordBreak}
            onPress={() => setCodeWordBreak(!appearance.codeWordBreak)}
          >
            <Toolbar.Label>Word wrap</Toolbar.Label>
          </Toolbar.MenuAction>
          <Toolbar.MenuAction
            icon="line.3.horizontal.decrease"
            isOn={filter.hideTestFiles}
            onPress={toggleTestFiles}
          >
            <Toolbar.Label>Hide test files</Toolbar.Label>
          </Toolbar.MenuAction>
          {selectedRow && selectedFile && canCommentOnDiff ? (
            <Toolbar.MenuAction icon="bubble.left" onPress={() => commentOnLine()}>
              <Toolbar.Label>
                {route.params.replacingDraftId ? "Move draft to this line" : "Add review comment"}
              </Toolbar.Label>
            </Toolbar.MenuAction>
          ) : null}
          {selectedRow && selectedFile ? (
            <Toolbar.MenuAction
              icon="document.on.document"
              onPress={() => void Clipboard.setStringAsync(selectedRow.content ?? "")}
            >
              <Toolbar.Label>Copy line</Toolbar.Label>
            </Toolbar.MenuAction>
          ) : null}
        </Toolbar.Menu>
      </Toolbar>
      {route.params.replacingDraftId ? (
        <Text className="px-4 py-2 text-xs text-foreground-muted">
          Select a current line, then choose “Move draft to this line” from its menu.
        </Text>
      ) : null}
      {viewed.error ? (
        <Text className="px-4 py-2 text-xs text-danger-foreground">{viewed.error}</Text>
      ) : null}
      {staleDiff ? (
        <View
          className="flex-row items-center gap-2 px-4 py-2"
          style={{ paddingTop: Platform.OS === "ios" ? insets.top + 8 : 8 }}
        >
          <Text className="min-w-0 flex-1 text-xs text-foreground-muted">
            The branch changed. Reload before adding line comments.
          </Text>
          <Button
            label="Reload changes"
            onPress={() => {
              result.refresh();
              setDiffHead({ scopeKey, sha: detail.data?.headSha ?? null });
              jumpStarted.current = false;
              setSelectedRowId(null);
              setCollapsedIds(EMPTY_IDS);
            }}
          />
        </View>
      ) : null}
      <View
        className={
          Platform.OS === "android"
            ? "flex-1 overflow-hidden rounded-t-[28px] bg-sheet-solid"
            : "flex-1"
        }
        collapsable={false}
        style={{ marginHorizontal: Platform.OS === "android" && layout.usesSplitView ? 4 : 0 }}
      >
        {loadingDiff || result.error ? (
          <View style={{ paddingTop: Platform.OS === "ios" && !staleDiff ? insets.top : 0 }}>
            <PullRequestReadStatus
              pending={loadingDiff}
              error={result.error}
              terminology={terminology}
            />
          </View>
        ) : null}
        {NativeDiffView && data.rows.length && !seekingFile ? (
          <View className="flex-1" collapsable={false}>
            <NativeDiffView
              {...pullRequestDiffInitialPosition(targetFile?.id, focusIndex)}
              nativeViewRef={nativeView}
              refreshing={result.refreshing}
              onPullToRefresh={result.onPullRefresh}
              style={StyleSheet.absoluteFill}
              rowsJson={bridge.rowsJson}
              themeJson={bridge.themeJson}
              styleJson={bridge.styleJson}
              tokensPatchJson={bridge.tokensPatchJson}
              tokensResetKey={bridge.tokensResetKey}
              collapsedFileIdsJson={bridge.collapsedFileIdsJson}
              onDebug={onDebug}
              viewedFileIdsJson={bridge.viewedFileIdsJson}
              selectedRowIdsJson={bridge.selectedRowIdsJson}
              onPressLine={(event) => {
                const rowId = event.nativeEvent.rowId ?? null;
                setSelectedRowId(rowId);
                if (event.nativeEvent.gesture !== "longPress") commentOnLine(rowId);
              }}
              onToggleViewedFile={(event) => {
                const file = data.files.find((file) => file.id === event.nativeEvent.fileId);
                if (!file || (!commit && !viewed.canToggle)) return;
                const wasViewed = commit
                  ? commitViewedPaths.has(file.path)
                  : viewed.isViewed(file.path);
                setCollapsedIds((ids) =>
                  wasViewed
                    ? ids.filter((id) => id !== file.id)
                    : ids.includes(file.id)
                      ? ids
                      : [...ids, file.id],
                );
                if (commit)
                  setCommitViewedPaths((current) => {
                    const next = new Set(current);
                    if (next.has(file.path)) next.delete(file.path);
                    else next.add(file.path);
                    return next;
                  });
                else void viewed.toggle(file.path);
              }}
              onToggleComment={(event) => {
                const id = event.nativeEvent.commentId;
                if (id?.startsWith("discussion:"))
                  navigation.navigate("PullRequestDiscussion", {
                    ...route.params,
                    discussionId: id.slice("discussion:".length),
                  });
                if (id?.startsWith("draft:")) {
                  const draft = reviewDraft.draft.comments.find(
                    (draft) => draft.id === id.slice("draft:".length),
                  );
                  if (draft)
                    navigation.navigate("PullRequestInlineComment", {
                      ...route.params,
                      ...draft,
                      draftId: draft.id,
                    });
                }
              }}
              onToggleFile={onToggleFile}
              onVisibleFileChange={(event) => setVisibleFileId(event.nativeEvent.fileId ?? null)}
              appearanceScheme={themeAppearance}
              rowHeight={nativeReviewDiffStyle.rowHeight}
              contentWidth={NATIVE_REVIEW_DIFF_CONTENT_WIDTH}
              contentInsetTop={Platform.OS === "ios" ? (staleDiff ? 0 : insets.top) : undefined}
              contentInsetBottom={Platform.OS === "android" ? toolbarHeight : insets.bottom}
              contentResetKey={`pull-request:${route.params.environmentId}:${route.params.repository}:${route.params.number}:${commit ?? "all"}`}
            />
          </View>
        ) : filter.hiddenCount > 0 &&
          !data.rows.length &&
          !result.isPending &&
          !result.error &&
          !seekingFile ? (
          <View style={{ paddingTop: Platform.OS === "ios" ? insets.top : 0 }}>
            <EmptyState
              title="Only test files changed"
              detail="Test files are hidden from this review."
              action={<Button label="Show test files" tone="contrast" onPress={filter.showAll} />}
              variant="plain"
            />
          </View>
        ) : !result.isPending && !result.error && !seekingFile ? (
          <EmptyState
            title="Diff unavailable"
            detail={`Open this ${terminology.singular} on its provider to view the changes.`}
            variant="plain"
          />
        ) : null}
        {result.nextCursor && result.isPending && data.rows.length && !seekingFile ? (
          <View className="flex-row items-center justify-center gap-2 py-2">
            <AppActivityIndicator size="small" />
            <Text className="text-xs text-foreground-muted">Loading more files…</Text>
          </View>
        ) : null}
        {result.error && result.nextCursor ? (
          <View className="self-center">
            <Button label="Retry loading remaining files" tone="text" onPress={result.refresh} />
          </View>
        ) : null}
        {parsed.kind === "files" && parsed.notice ? (
          <Text className="px-4 py-2 text-2xs text-foreground-muted">{parsed.notice}</Text>
        ) : null}
      </View>
      <PullRequestActionToolbar
        pr={detail.data}
        params={route.params}
        filePath={visibleFile?.path}
        onOpenFiles={() => navigation.navigate("PullRequestFiles", route.params)}
        onHeightChange={setToolbarHeight}
      />
    </View>
  );
}
