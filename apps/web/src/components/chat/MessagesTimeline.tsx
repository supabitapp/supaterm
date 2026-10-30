import { useDeferredWorkLoading } from "./useDeferredWorkLoading";
import { AudioPreviewUnmountContext } from "../files/AudioPreview";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Skeleton } from "../ui/skeleton";
import { TimelinePendingApprovalRow } from "./TimelinePendingApprovalRow";
import { attachTimelineViewport, type TimelineViewport } from "./timelineViewport";
import { usePaneInputOwner } from "../../chatPanes/paneScope";
import { CircleAlertIcon } from "@supaterm/icons";
import type { TurnItemSource } from "./timelineRowContext";
import { TimelineMinimap } from "./TimelineMinimap";
import {
  type WorkGroupViewState,
  type TimelineRowSharedState,
  type TimelineRowActivityState,
  TimelineRowCtx,
  TimelineRowActivityCtx,
  type TimelineRow,
} from "./timelineRowContext";
import { ActivityShimmerOverlay, TimelineRowTimestamp } from "./TimelineRowParts";
import {
  WorkGroupSection,
  LiveWorkEntryTimelineRow,
  WorkGroupToggleTimelineRow,
  ThinkingTimelineRow,
  WorkingTimelineRow,
} from "./TimelineWorkGroupRows";
import { UserMessageRow } from "./TimelineUserMessageRow";
import {
  AssistantTimelineRow,
  AssistantMetaTimelineRow,
  ProposedPlanTimelineRow,
  HtmlRenderTimelineRow,
  McpAppTimelineRow,
} from "./TimelineAssistantRows";
import { V2EventTimelineRow } from "./TimelineV2EventRow";
import { useIncrementalTimelineRows, useStableRows, useStableHandoffRuns } from "./useTimelineRows";
import { useTimelinePositionRestore } from "./useTimelinePositionRestore";
import { useThreadFindPositionReader } from "./useThreadFindPositionReader";
import { ThreadFindTimelineContext } from "./ThreadFindProvider";
import {
  type ThreadHistoryControls,
  createThreadHistoryPrefetcher,
  THREAD_HISTORY_PREFETCH_VIEWPORTS,
} from "@supaterm/client-runtime/thread-history-prefetch";
import { MarkdownFindContext } from "./markdownFindContext";
import { useChatCanvas } from "./ChatCanvasContext";
import { ThreadTimelineLoading } from "./ThreadTimelineLoading";
import { WorkLogBlock } from "./WorkLog";
import type {
  ServerProviderSkill,
  RunId,
  AssistantCitation,
  WorktreeSetupSnapshot,
  OrchestrationV2TurnItem,
  ThreadId,
  MessageId,
  EnvironmentId,
  RunAttemptId,
  ThreadPinnedMessage,
} from "@supaterm/contracts";
import { deriveTimelineMinimapItems } from "./timelineMinimapItems";
import { parseScopedThreadKey } from "@supaterm/client-runtime/environment";
import { resolveWorkGroupScrollAnchor } from "@supaterm/client-runtime/work-log/scroll-anchor";
import type { WorkflowOpening } from "@supaterm/client-runtime/state/subagentRuntime";
import { observeResize } from "~/lib/observeResize";
import { useStableCallback } from "~/hooks/useStableCallback";
import { resolveChatListAnchoredEndSpace } from "@supaterm/shared/chatList";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import {
  type ReactNode,
  type SyntheticEvent,
  useContext,
  useEffect,
  useEffectEvent,
  memo,
  useState,
  useRef,
  useLayoutEffect,
  use,
} from "react";
import {
  type MaintainScrollAtEndOptions,
  type LegendListRef,
  LegendList,
} from "@legendapp/list/react";
import type { PendingApproval, TimelineEntry } from "../../session-logic";
import type { CodexArtifactTemplate } from "@supaterm/shared/codexArtifactTemplates";
import type { ChatFileAttachment, TurnDiffSummary } from "../../types";
import { ArrowRightIcon, BotIcon, ShrinkIcon } from "@supaterm/icons";
import { ChevronDown, ChevronRight } from "@supaterm/icons/nodes";
import { MorphIcon } from "~/components/MorphIcon";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { ExpandedPreviewHostContext } from "./ExpandedPreviewDialog";
import {
  type RememberedTimelinePosition,
  readTimelinePosition,
  CHAT_TIMELINE_ANCHOR_OFFSET,
  timelineContentOverflowsViewport,
  rememberTimelinePosition,
} from "./timelineScrollAnchoring";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import type { AssistantCitationRequest } from "./AssistantCitationSource";
import { useAssistantCitationTarget } from "./useAssistantCitationTarget";
import { resolveCitationPhase, type CitedHistory } from "./citationProcedure";
import {
  type TimelineLatestRun,
  resolveTimelineIsAtEnd,
  type MessagesTimelineRow,
  timelineTurnFoldRunIdsByEntryId,
  resolveTimelineMinimapVisibleRange,
  isTimelineMinimapRowVisible,
  resolveTimelineMinimapCurrentIndex,
  resolveTimelineMinimapHasPersistentGutter,
  resolveTimelineMinimapHitStripWidth,
  worktreeSetupAgentStarted,
} from "./MessagesTimeline.logic";
import type { ThreadFindPositionReader, ThreadFindMatch } from "./threadFind";
import { useThreadFindNavigation } from "./useThreadFindNavigation";
import { useTimelineMessageJump } from "./useTimelineMessageJump";
import type { MessageJump, MessageJumpHandlers } from "@supaterm/client-runtime/message-jump";
import type { PinnableProjectedItem } from "./PinnedMessages";
import { TooltipScrollDismissArea } from "../ui/tooltip";
import { WorktreeSetupCard } from "./WorktreeSetupCard";
import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { useClientSettings } from "~/hooks/useSettings";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import type { TimestampFormat } from "@supaterm/contracts/settings";
import {
  waitForDisclosureSettle,
  type TimelineDisclosureToggle,
  TimelineDisclosureContext,
} from "./timelineDisclosure";
import type { HandoffTimelineRun } from "./V2LifecycleRow";
import { TimelineSystemDivider } from "./TimelineSystemDivider";
import { forwardWheelToTimeline } from "./timelineMinimapWheel";

const NOOP_USE_ARTIFACT_TEMPLATE = () => {};
const NOOP_OPEN_ATTACHMENT = (_attachment: ChatFileAttachment) => {};

function timelineListStateFor(identity: string): {
  readonly identity: string;
  readonly rememberedPosition: RememberedTimelinePosition | undefined;
  readonly workGroupViewState: WorkGroupViewState;
} {
  const rememberedPosition = readTimelinePosition(identity);
  return {
    identity,
    rememberedPosition,
    workGroupViewState: rememberedPosition?.disclosures?.workGroupState ?? {
      scrollPositions: new Map(),
      expandedEntries: new Set(),
    },
  };
}

const TIMELINE_LIST_HEADER = <div className="h-3 sm:h-4" />;
const TIMELINE_LIST_FADE_HEADER = (
  <div className="h-[var(--workspace-titlebar-scroll-fade-height)]" />
);
function TimelineListFooter({
  composerInset,
  onGrow,
  children,
}: {
  readonly composerInset: number;
  readonly onGrow?: (() => void) | undefined;
  readonly children?: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Footer growth is outside the virtual list's item measurements; notify its follow controller after DOM resize.
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element || !onGrow) return;
    let height = element.offsetHeight;
    return observeResize(element, () => {
      const next = element.offsetHeight;
      if (next > height) onGrow();
      height = next;
    });
  }, [onGrow]);
  return (
    <div>
      <div ref={contentRef}>{children}</div>
      <div aria-hidden style={{ height: composerInset }} />
      <div aria-hidden className="h-3 sm:h-4" />
    </div>
  );
}

const EMPTY_TIMELINE_SKILLS: ReadonlyArray<ServerProviderSkill> = [];
const TIMELINE_MAINTAIN_SCROLL_AT_END = {
  animated: false,
  on: {
    dataChange: true,
    footerLayout: false,
    itemLayout: true,
    layout: true,
  },
} as const satisfies MaintainScrollAtEndOptions;

const CITED_HISTORY_LOADING: CitedHistory = { _tag: "loading" };
const EMPTY_RUN_IDS: ReadonlySet<RunId> = new Set();
const EMPTY_PINNED_MESSAGES: ReadonlyArray<ThreadPinnedMessage> = [];
const NOOP_MESSAGE_JUMP_FAILED = () => {};
const TIMELINE_MAINTAIN_SCROLL_AT_END_SMOOTH = {
  ...TIMELINE_MAINTAIN_SCROLL_AT_END,
  animated: true,
} as const satisfies MaintainScrollAtEndOptions;

export type MessagesTimelineHistoryControls = ThreadHistoryControls;

const EMPTY_PENDING_APPROVALS: ReadonlyArray<PendingApproval> = [];
const EMPTY_RESPONDING_REQUEST_IDS: TimelineRowSharedState["respondingRequestIds"] = [];
interface MessagesTimelineProps {
  pendingApprovals?: ReadonlyArray<PendingApproval>;
  heldApprovalRequestIds?: ReadonlySet<string> | undefined;
  respondingRequestIds?: TimelineRowSharedState["respondingRequestIds"];
  canOperateThread?: boolean;
  onRespondToApproval?: TimelineRowSharedState["onRespondToApproval"];

  citationRequest?: AssistantCitationRequest | null;
  citationHistory?: CitedHistory;
  onCiteAssistantText?: (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => boolean;
  isWorking: boolean;
  runlessWorkActive?: boolean;
  activeTurnInProgress?: boolean;
  activeTurnStartedAt?: string | null;
  worktreeSetup?: WorktreeSetupSnapshot | null;
  onCancelWorktreeSetup?: () => void;
  retryableWorkspacePreparationRunIds?: ReadonlySet<RunId>;
  onRetryWorkspacePreparation?: (runId: RunId) => void;
  onWorktreeSetupWorkLocally?: () => void;
  onOpenWorktreeSetupTerminal?: (terminalId: string) => void;
  isPreparingWorktree?: boolean;
  isCompacting?: boolean;

  awaitingUser?: boolean;
  footer?: ReactNode;

  listRef: React.RefObject<LegendListRef | null>;
  timelineEntries: ReadonlyArray<TimelineEntry>;
  latestRun: TimelineLatestRun | null;
  runningRunId?: RunId | null;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  routeThreadKey: string;
  displayThreadKey?: string;
  paintOnly?: boolean;
  onOpenTurnDiff?: (runId: RunId, filePath?: string) => void;
  renderHtmlRender?: (row: Extract<TimelineRow, { kind: "html-render" }>) => ReactNode;
  turnItemSource?: TurnItemSource;
  onOpenThread: (threadId: OrchestrationV2TurnItem["threadId"]) => void;
  parentThreadLink?: {
    readonly threadId: ThreadId;
    readonly title: string;
  } | null;
  /** Set on a workflow coordinator's thread: its script message renders as this opening. */
  workflowOpening?: WorkflowOpening | null;
  onForkFromRun?: (input: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
  }) => Promise<void>;
  supportsConversationRollback: boolean;
  threadStartCheckpointReady?: boolean;
  availableRevertTurnCounts?: ReadonlySet<number> | undefined;
  onRevertToTurnCount: (targetTurnCount: number, messageId: MessageId) => void;
  onUseArtifactTemplate?: (template: CodexArtifactTemplate) => void;
  onSendAppMessage?: (text: string) => Promise<void>;
  onRunShellCommand?: (command: string) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onFileOpen?: (attachment: ChatFileAttachment) => void;
  onFileDownload?: (attachment: ChatFileAttachment) => void;
  activeThreadEnvironmentId: EnvironmentId;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  skills?: ReadonlyArray<ServerProviderSkill>;
  runs: ReadonlyArray<HandoffTimelineRun>;
  anchorMessageId: MessageId | null;
  onAnchorReady: (messageId: MessageId, anchorIndex: number) => void;
  onAnchorSizeChanged: (messageId: MessageId, size: number) => void;
  contentInsetEndAdjustment: number;
  onIsAtEndChange: (isAtEnd: boolean) => void;
  /**
   * Off while the user is reading history; LegendList's own maintainScrollAtEnd
   * would otherwise re-pin regardless of ChatView's scroll-mode refs whenever
   * the user drifts near the bottom.
   */
  liveFollowEnabled: boolean;
  onContentOverflowChange?: (overflows: boolean) => void;
  onToolOutputCollapsedAtEnd?: () => void;
  onManualNavigation?: () => void;
  onViewportAttach?: (viewport: TimelineViewport) => () => void;
  onFooterGrow?: () => void;
  findOpen?: boolean;
  cancelPositionRestoreRef?: React.RefObject<(() => void) | null> | undefined;
  hideEmptyPlaceholder?: boolean;
  loading?: boolean;
  /** Composer space to center the empty state against; held steady through collapse. */
  emptyPlaceholderInset: number;
  topFadeEnabled?: boolean;
  historyControls?: MessagesTimelineHistoryControls | undefined;
  pinnedMessages?: ReadonlyArray<ThreadPinnedMessage>;
  onTogglePinnedMessage?: (projectedItem: PinnableProjectedItem, pinned: boolean) => void;
  messageJump?: MessageJump | null;
  onMessageJumpFailed?: MessageJumpHandlers["fail"];
  findPositionReaderRef?: React.RefObject<ThreadFindPositionReader | null>;
  findExpanded?: boolean;
  findQuery?: string;
  activeFindMatch?: ThreadFindMatch | null;
  findNavigationId?: number;
}

export function MessagesTimeline(props: MessagesTimelineProps) {
  const find = useContext(ThreadFindTimelineContext);
  const findOpen = find?.findOpen ?? props.findOpen;
  const { onManualNavigation = NOOP_MESSAGE_JUMP_FAILED } = props;
  useEffect(() => {
    if (findOpen) onManualNavigation();
  }, [findOpen, onManualNavigation]);
  return (
    <ConversationTimeline
      {...props}
      {...find}
      liveFollowEnabled={!findOpen && props.liveFollowEnabled}
    />
  );
}

const ConversationTimeline = memo(function ConversationTimeline({
  pendingApprovals = EMPTY_PENDING_APPROVALS,
  heldApprovalRequestIds,
  respondingRequestIds = EMPTY_RESPONDING_REQUEST_IDS,
  canOperateThread = false,
  onRespondToApproval,
  citationRequest = null,
  citationHistory = CITED_HISTORY_LOADING,
  onCiteAssistantText,
  isWorking,
  runlessWorkActive = false,
  activeTurnInProgress = isWorking,
  activeTurnStartedAt = null,
  worktreeSetup = null,
  footer = null,
  onCancelWorktreeSetup,
  retryableWorkspacePreparationRunIds = EMPTY_RUN_IDS,
  onRetryWorkspacePreparation,
  onWorktreeSetupWorkLocally,
  onOpenWorktreeSetupTerminal,
  isPreparingWorktree = false,
  isCompacting = false,
  awaitingUser = false,
  listRef,
  timelineEntries,
  findExpanded = false,
  findQuery = "",
  activeFindMatch = null,
  findNavigationId = 0,
  findPositionReaderRef,
  latestRun,
  runningRunId = null,
  turnDiffSummaries,
  routeThreadKey,
  displayThreadKey,
  paintOnly = false,
  onOpenTurnDiff,
  renderHtmlRender,
  turnItemSource,
  onOpenThread,
  parentThreadLink = null,
  workflowOpening = null,
  onForkFromRun,
  supportsConversationRollback,
  threadStartCheckpointReady = false,
  availableRevertTurnCounts,
  onRevertToTurnCount,
  onUseArtifactTemplate = NOOP_USE_ARTIFACT_TEMPLATE,
  onSendAppMessage,
  onRunShellCommand,
  isRevertingCheckpoint,
  onImageExpand,
  onFileOpen = NOOP_OPEN_ATTACHMENT,
  onFileDownload = NOOP_OPEN_ATTACHMENT,
  activeThreadEnvironmentId,
  markdownCwd,
  resolvedTheme,
  timestampFormat,
  workspaceRoot,
  skills = EMPTY_TIMELINE_SKILLS,
  runs: runsProp,
  anchorMessageId,
  onAnchorReady,
  onAnchorSizeChanged,
  contentInsetEndAdjustment,
  onIsAtEndChange,
  onContentOverflowChange,
  liveFollowEnabled,
  onToolOutputCollapsedAtEnd,
  onManualNavigation = NOOP_MESSAGE_JUMP_FAILED,
  onViewportAttach,
  onFooterGrow,
  cancelPositionRestoreRef,
  hideEmptyPlaceholder = false,
  loading = false,
  emptyPlaceholderInset,
  topFadeEnabled = false,
  historyControls,
  pinnedMessages = EMPTY_PINNED_MESSAGES,
  onTogglePinnedMessage,
  messageJump = null,
  onMessageJumpFailed = NOOP_MESSAGE_JUMP_FAILED,
}: MessagesTimelineProps) {
  const listIdentityKey = displayThreadKey ?? routeThreadKey;
  // The remembered position is a snapshot taken when the list identity changes;
  // scrolling keeps rewriting the stored entry, which must not move the restore.
  const [listState, setListState] = useState(() => timelineListStateFor(listIdentityKey));
  const [expandedRunIds, setExpandedRunIds] = useState<ReadonlySet<RunId>>(
    () => listState.rememberedPosition?.disclosures?.runs ?? new Set(),
  );
  const [expandedWorkGroupIds, setExpandedWorkGroupIds] = useState<ReadonlySet<string>>(
    () => listState.rememberedPosition?.disclosures?.workGroups ?? new Set(),
  );
  const [expandedAttemptIds, setExpandedAttemptIds] = useState<ReadonlySet<RunAttemptId>>(
    () => listState.rememberedPosition?.disclosures?.attempts ?? new Set(),
  );
  const [positionedThreadKey, setPositionedThreadKey] = useState<string | null>(() =>
    listState.rememberedPosition?.atEnd === false ? null : listIdentityKey,
  );
  const restoringThreadPosition = positionedThreadKey !== listIdentityKey;
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [settlingListIdentity, setSettlingListIdentity] = useState<string | null>(listIdentityKey);
  let paintedExpandedRunIds = expandedRunIds;
  let paintedExpandedWorkGroupIds = expandedWorkGroupIds;
  let paintedExpandedAttemptIds = expandedAttemptIds;
  const [playingAudioRows, setPlayingAudioRows] = useState<ReadonlyMap<HTMLAudioElement, string>>(
    () => new Map(),
  );
  const identityChanged = listState.identity !== listIdentityKey;
  const { rememberedPosition, workGroupViewState } = identityChanged
    ? timelineListStateFor(listIdentityKey)
    : listState;
  if (identityChanged) {
    setPlayingAudioRows(new Map());
    setListState({ identity: listIdentityKey, rememberedPosition, workGroupViewState });
    setPositionedThreadKey(null);
    setSettlingListIdentity(listIdentityKey);
    paintedExpandedRunIds = rememberedPosition?.disclosures?.runs ?? new Set();
    paintedExpandedWorkGroupIds = rememberedPosition?.disclosures?.workGroups ?? new Set();
    paintedExpandedAttemptIds = rememberedPosition?.disclosures?.attempts ?? new Set();
    setExpandedRunIds(paintedExpandedRunIds);
    setExpandedWorkGroupIds(paintedExpandedWorkGroupIds);
    setExpandedAttemptIds(paintedExpandedAttemptIds);
  }
  const citationThreadRef = parseScopedThreadKey(routeThreadKey);
  const openPullRequest = useOpenPrLink(citationThreadRef ?? undefined);
  const expandCitedRun = (runId: RunId) => {
    setExpandedRunIds((current) => (current.has(runId) ? current : new Set([...current, runId])));
  };
  const [minimapStripMap] = useState(() => new Map<string, HTMLSpanElement>());
  const [disclosureToggleSettling, setDisclosureToggleSettling] = useState(false);
  const disclosureAnchorKeyRef = useRef<string | null>(null);
  const disclosureSettleRef = useRef<{
    readonly cancel: () => void;
    readonly followingEnd: boolean;
  } | null>(null);
  useEffect(() => () => disclosureSettleRef.current?.cancel(), []);
  const endFollowAllowedRef = useRef(false);
  const normalizedFindQuery = findQuery.trim();
  const findActive = findExpanded;

  useEffect(() => {
    if (settlingListIdentity === null) return;
    let second: number | null = null;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setSettlingListIdentity((current) => (current === settlingListIdentity ? null : current));
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (second !== null) cancelAnimationFrame(second);
    };
  }, [settlingListIdentity]);

  // End-follow stays off and only the toggled row anchors until that row has
  // finished resizing, so an animated disclosure is never chased or yanked.
  const suspendEndScrollMaintenanceForDisclosure = (anchorKey: string, collapsed = false) => {
    const pending = disclosureSettleRef.current;
    pending?.cancel();
    // Rows streamed in during the hold push the end away, so the toggle-time
    // position decides whether a close returns to the live edge.
    const followingEnd =
      pending?.followingEnd === true ||
      resolveTimelineIsAtEnd(listRef.current?.getState()) === true;
    disclosureAnchorKeyRef.current = anchorKey;
    setDisclosureToggleSettling(true);
    const cancel = waitForDisclosureSettle(
      () => {
        const state = listRef.current?.getState();
        const index = state?.indexByKey(anchorKey);
        if (state === undefined || index === undefined) return null;
        return { size: state.sizeAtIndex(index), element: state.elementAtIndex(index) };
      },
      () => {
        disclosureSettleRef.current = null;
        disclosureAnchorKeyRef.current = null;
        setDisclosureToggleSettling(false);
        if (!collapsed) return;
        const list = listRef.current;
        let atEnd = resolveTimelineIsAtEnd(list?.getState()) === true;
        if (!atEnd && followingEnd && endFollowAllowedRef.current && list) {
          void list.scrollToEnd({ animated: false });
          atEnd = true;
        }
        if (atEnd) onToolOutputCollapsedAtEnd?.();
      },
    );
    disclosureSettleRef.current = { cancel, followingEnd };
  };
  const onDisclosureToggle: TimelineDisclosureToggle = (target, closing) => {
    if (!(target instanceof Element)) return;
    const rowId = target.closest<HTMLElement>("[data-timeline-row-id]")?.dataset.timelineRowId;
    if (rowId !== undefined) suspendEndScrollMaintenanceForDisclosure(rowId, closing);
  };

  const shouldRestoreVisibleContentPosition = (row: MessagesTimelineRow) => {
    const disclosureAnchorKey = disclosureAnchorKeyRef.current;
    return disclosureAnchorKey === null || row.id === disclosureAnchorKey;
  };

  const onToggleTurnFold = (runId: RunId) => {
    suspendEndScrollMaintenanceForDisclosure(`turn-fold:${runId}`);
    setExpandedRunIds((existing) => {
      const next = new Set(existing);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };
  const onToggleWorkGroup = (groupId: string, anchorKey: string) => {
    suspendEndScrollMaintenanceForDisclosure(anchorKey, expandedWorkGroupIds.has(groupId));
    setExpandedWorkGroupIds((existing) => {
      const next = new Set(existing);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };
  const onToggleAttemptFold = (attemptId: RunAttemptId) => {
    suspendEndScrollMaintenanceForDisclosure(`attempt-fold:${attemptId}`);
    setExpandedAttemptIds((existing) => {
      const next = new Set(existing);
      if (next.has(attemptId)) {
        next.delete(attemptId);
      } else {
        next.add(attemptId);
      }
      return next;
    });
  };

  const previousLatestRunRef = useRef({ identity: listIdentityKey, run: latestRun });
  useEffect(() => {
    const { identity, run: previous } = previousLatestRunRef.current;
    previousLatestRunRef.current = { identity: listIdentityKey, run: latestRun };
    if (identity !== listIdentityKey || !latestRun || previous?.runId === undefined) {
      return;
    }
    if (latestRun.runId === previous.runId) {
      if (previous.status === "running" && latestRun.status === "interrupted") {
        setExpandedRunIds((existing) => {
          const next = new Set(existing);
          next.add(latestRun.runId);
          return next;
        });
      }
      return;
    }
    setExpandedRunIds((existing) => {
      if (!existing.has(previous.runId)) {
        return existing;
      }
      const next = new Set(existing);
      next.delete(previous.runId);
      return next;
    });
  }, [latestRun, listIdentityKey]);

  const findFoldRunIds = findActive
    ? timelineTurnFoldRunIdsByEntryId({
        timelineEntries,
        latestRun,
        runningRunId,
        isWorking,
        runlessWorkActive,
      })
    : null;
  const activeFindRunId =
    findActive && activeFindMatch ? findFoldRunIds?.get(activeFindMatch.entryId) : undefined;
  const [expandedFindRunId, setExpandedFindRunId] = useState<RunId | undefined>();
  if (expandedFindRunId !== activeFindRunId) {
    setExpandedFindRunId(activeFindRunId);
    if (activeFindRunId) {
      setExpandedRunIds((previous) =>
        previous.has(activeFindRunId) ? previous : new Set(previous).add(activeFindRunId),
      );
    }
  }
  const [citationExpandedFor, setCitationExpandedFor] = useState<string | null>(null);
  if (!citationRequest && citationExpandedFor !== null) setCitationExpandedFor(null);
  const citedEntry =
    citationRequest &&
    citationExpandedFor !== citationRequest.key &&
    citationHistory._tag !== "failed"
      ? timelineEntries.find(
          (entry) =>
            entry.kind === "message" &&
            entry.message.role === "assistant" &&
            entry.message.id === citationRequest.citation.messageId,
        )
      : undefined;
  if (citationRequest && citedEntry) {
    const runId = (
      findFoldRunIds ??
      timelineTurnFoldRunIdsByEntryId({
        timelineEntries,
        latestRun,
        runningRunId,
        isWorking,
        runlessWorkActive,
      })
    ).get(citedEntry.id);
    setCitationExpandedFor(citationRequest.key);
    if (runId)
      setExpandedRunIds((previous) =>
        previous.has(runId) ? previous : new Set(previous).add(runId),
      );
    if (citedEntry.attempt?.status === "superseded") {
      const attemptId = citedEntry.attempt.id;
      setExpandedAttemptIds((previous) =>
        previous.has(attemptId) ? previous : new Set(previous).add(attemptId),
      );
    }
  }
  const visibleExpandedRunIds =
    !activeFindRunId || paintedExpandedRunIds.has(activeFindRunId)
      ? paintedExpandedRunIds
      : new Set(paintedExpandedRunIds).add(activeFindRunId);

  const activeFindAttemptId = activeFindMatch
    ? timelineEntries.find((entry) => entry.id === activeFindMatch.entryId)?.attempt?.id
    : undefined;
  const [expandedFindAttemptId, setExpandedFindAttemptId] = useState<RunAttemptId | undefined>();
  if (expandedFindAttemptId !== activeFindAttemptId) {
    setExpandedFindAttemptId(activeFindAttemptId);
    if (activeFindAttemptId) {
      setExpandedAttemptIds((previous) =>
        previous.has(activeFindAttemptId) ? previous : new Set(previous).add(activeFindAttemptId),
      );
    }
  }
  const visibleExpandedAttemptIds =
    activeFindAttemptId && !paintedExpandedAttemptIds.has(activeFindAttemptId)
      ? new Set(paintedExpandedAttemptIds).add(activeFindAttemptId)
      : paintedExpandedAttemptIds;

  const pendingApprovalsByRequestId = new Map(
    pendingApprovals
      .filter((approval) => !heldApprovalRequestIds?.has(approval.requestId))
      .map((approval) => [approval.requestId, approval]),
  );
  const pendingApprovalRequestIds = new Set(pendingApprovalsByRequestId.keys());
  const rawRows = useIncrementalTimelineRows(`${listIdentityKey}\0${workspaceRoot ?? ""}`, {
    timelineEntries,
    pendingApprovalRequestIds,
    latestRun,
    runningRunId,
    expandedRunIds: visibleExpandedRunIds,
    expandedAttemptIds: visibleExpandedAttemptIds,
    expandedWorkGroupIds,
    isWorking,
    runlessWorkActive,
    activeTurnStartedAt,
    turnDiffSummaries,
    supportsConversationRollback,
    threadStartCheckpointReady,
    availableRevertTurnCounts,
    worktreeSetup,
  });
  const rows = useStableRows(rawRows, listIdentityKey);
  const unmatchedPendingApprovals = new Map(pendingApprovalsByRequestId);
  for (const row of rows) {
    const entries =
      row.kind === "work" ? row.groupedEntries : row.kind === "work-live" ? [row.entry] : [];
    for (const entry of entries) {
      const item = entry.projectedItem?.item;
      if (item?.type === "approval_request") unmatchedPendingApprovals.delete(item.requestId);
    }
  }
  // Run status/timestamps churn on every stream event; the shared row context
  // must not change with them or every timeline row re-renders per event.
  const runs = useStableHandoffRuns(runsProp);
  const pinnedItemIds = new Set(pinnedMessages.map((pin) => pin.itemId));
  const minimapItems = deriveTimelineMinimapItems(rows, pinnedItemIds);
  const minimapRowIndices = minimapItems.map((item) => item.rowIndex);

  const restoreRowIndex =
    restoringThreadPosition && rememberedPosition?.atEnd === false
      ? rows.findIndex((row) => row.id === rememberedPosition.rowId)
      : -1;
  const restoringAlwaysRender =
    restoringThreadPosition && restoreRowIndex >= 0 ? { indices: [restoreRowIndex] } : undefined;
  const viewportRef = useRef<TimelineViewport | null>(null);
  useTimelinePositionRestore({
    viewportRef,
    listRef,
    listIdentityKey,
    restoringThreadPosition,
    rememberedPosition,
    rows,
    citationRequest,
    cancelPositionRestoreRef,
    onManualNavigation,
    onPositioned: setPositionedThreadKey,
  });

  const [timelineViewportElement, setTimelineViewportElement] = useState<HTMLDivElement | null>(
    null,
  );
  const chatWidth = useClientSettings((settings) => settings.chatWidth);
  const turnFoldRunIdOf = (entryId: string) =>
    (
      findFoldRunIds ??
      timelineTurnFoldRunIdsByEntryId({
        timelineEntries,
        latestRun,
        runningRunId,
        isWorking,
        runlessWorkActive,
      })
    ).get(entryId);
  const {
    target: readyCitationRequest,
    positioning: citationPositioning,
    onListLoad: onCitationListLoad,
    alwaysRender: citationAlwaysRender,
  } = useAssistantCitationTarget({
    request: citationRequest,
    phase: citationRequest
      ? resolveCitationPhase({
          history: citationHistory,
          messageId: citationRequest.citation.messageId,
          entries: timelineEntries,
          rows,
        })
      : null,
    viewport: timelineViewportElement,
    onManualNavigation,
  });
  const [findListReady, setFindListReady] = useState(false);
  const [prefetchHistory] = useState(createThreadHistoryPrefetcher);
  const handleHistoryPrefetch = () => {
    const state = listRef.current?.getState();
    if (
      paintOnly ||
      (rows.length > 0 && (!findListReady || restoringThreadPosition)) ||
      findActive ||
      citationPositioning ||
      state?.data !== rows
    )
      return;
    prefetchHistory(listIdentityKey, historyControls, state);
  };
  useEffect(() => {
    const frame = requestAnimationFrame(handleHistoryPrefetch);
    return () => cancelAnimationFrame(frame);
  }, [handleHistoryPrefetch]);
  const handleListLoad = () => {
    onCitationListLoad();
    setFindListReady(true);
  };
  const [minimapHasPersistentGutter, setMinimapHasPersistentGutter] = useState(false);
  const [fullscreenAppRowId, setFullscreenAppRowId] = useState<string | null>(null);
  const onAppFullscreenChange = (rowId: string, fullscreen: boolean) => {
    setFullscreenAppRowId((current) => (fullscreen ? rowId : current === rowId ? null : current));
  };
  const alwaysRenderIndices = restoringAlwaysRender?.indices ?? [];
  const alwaysRenderKeys = [
    ...new Set(
      [...playingAudioRows].filter(([audio]) => audio.isConnected).map(([, rowId]) => rowId),
    ),
    ...(citationAlwaysRender?.keys ?? []),
    ...(fullscreenAppRowId === null ? [] : [fullscreenAppRowId]),
  ];
  const alwaysRender =
    alwaysRenderIndices.length === 0 && alwaysRenderKeys.length === 0
      ? undefined
      : {
          ...(alwaysRenderIndices.length === 0 ? {} : { indices: alwaysRenderIndices }),
          ...(alwaysRenderKeys.length === 0 ? {} : { keys: alwaysRenderKeys }),
        };
  const [minimapHitStripWidth, setMinimapHitStripWidth] = useState(0);
  const [minimapCurrentIndex, setMinimapCurrentIndex] = useState<number | null>(null);
  const handleAnchorReady = (info: { anchorIndex: number | undefined }) => {
    if (anchorMessageId !== null && info.anchorIndex !== undefined) {
      onAnchorReady(anchorMessageId, info.anchorIndex);
    }
  };
  const handleAnchorSizeChanged = (size: number) => {
    if (anchorMessageId !== null) {
      onAnchorSizeChanged(anchorMessageId, size);
    }
  };
  const anchoredEndSpaceConfig = resolveChatListAnchoredEndSpace(
    rows,
    anchorMessageId,
    (row) => (row.kind === "message" && row.message.role === "user" ? row.message.id : null),
    { anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET },
  );
  const anchoredEndSpace = anchoredEndSpaceConfig
    ? {
        ...anchoredEndSpaceConfig,
        onReady: handleAnchorReady,
        onSizeChanged: handleAnchorSizeChanged,
      }
    : undefined;
  const maintainVisibleContentPosition = {
    data: true,
    size: true,
    shouldRestorePosition: shouldRestoreVisibleContentPosition,
  };

  const measureContentOverflow = () =>
    timelineContentOverflowsViewport(listRef.current?.getState?.(), {
      composerInset: contentInsetEndAdjustment,
      anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
    });
  // LegendList lays rows out from layout effects, so a read on the next frame
  // sees the settled positions.
  const contentOverflowFrameRef = useRef<number | null>(null);
  const cancelContentOverflowFrame = () => {
    if (contentOverflowFrameRef.current !== null) {
      cancelAnimationFrame(contentOverflowFrameRef.current);
      contentOverflowFrameRef.current = null;
    }
  };
  const reportContentOverflow = () => {
    if (!onContentOverflowChange || contentOverflowFrameRef.current !== null) return;
    contentOverflowFrameRef.current = requestAnimationFrame(() => {
      contentOverflowFrameRef.current = null;
      onContentOverflowChange(measureContentOverflow());
    });
  };
  useEffect(() => cancelContentOverflowFrame, [cancelContentOverflowFrame]);
  useLayoutEffect(() => {
    cancelContentOverflowFrame();
    onContentOverflowChange?.(measureContentOverflow());
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- rows.length and layout inputs trigger a re-measure; the effect reads them through the DOM
  }, [cancelContentOverflowFrame, measureContentOverflow, onContentOverflowChange, rows.length]);

  const refreshMinimap = useStableCallback(() => {
    const state = listRef.current?.getState?.();
    if (restoringThreadPosition || state?.data !== rows) return;
    if (!state || minimapItems.length === 0) {
      return;
    }

    const firstBufferedIndex = state.startBuffered;
    const firstBufferedRow: HTMLElement | undefined =
      firstBufferedIndex == null ? undefined : state.elementAtIndex(firstBufferedIndex);
    const firstBufferedTop =
      firstBufferedIndex == null ? undefined : state.positionAtIndex(firstBufferedIndex);
    const viewport: HTMLElement | undefined = listRef.current?.getScrollableNode();
    // Cached row positions exclude the header and pending scroll adjustments.
    const scroll =
      firstBufferedRow && viewport && firstBufferedTop !== undefined
        ? firstBufferedTop +
          viewport.getBoundingClientRect().top -
          firstBufferedRow.getBoundingClientRect().top
        : state.scroll;
    const visibleRange = resolveTimelineMinimapVisibleRange({ ...state, scroll });
    for (const item of minimapItems) {
      const strip = minimapStripMap.get(item.id);
      const inView = isTimelineMinimapRowVisible(
        item.rowIndex,
        visibleRange.start,
        visibleRange.end,
      );
      const next = inView ? "true" : "false";
      // Avoid dirtying style state on every scroll tick for unchanged strips.
      if (strip && strip.dataset.inView !== next) {
        strip.dataset.inView = next;
      }
    }
    const nextCurrentIndex = resolveTimelineMinimapCurrentIndex({
      visibleStart: visibleRange.start,
      visibleEnd: visibleRange.end,
      rowIndices: minimapRowIndices,
    });
    setMinimapCurrentIndex((current) =>
      current === nextCurrentIndex ? current : nextCurrentIndex,
    );
  });

  const minimapRefreshFrameRef = useRef<number | null>(null);
  const scheduleMinimapRefresh = () => {
    if (minimapRefreshFrameRef.current !== null) return;
    // LegendList recycles row containers before React commits their positions.
    minimapRefreshFrameRef.current = requestAnimationFrame(() => {
      minimapRefreshFrameRef.current = null;
      refreshMinimap();
    });
  };

  const handleScroll = () => {
    handleHistoryPrefetch();
    const state = listRef.current?.getState?.();
    if (restoringThreadPosition || state?.data !== rows) return;
    const isAtEnd = resolveTimelineIsAtEnd(state);
    const position = state?.data?.length ? resolveWorkGroupScrollAnchor(state) : undefined;
    if (position && state && isAtEnd !== undefined && !paintOnly) {
      const index = state.indexByKey(position.rowId);
      const row = index === undefined ? undefined : state.elementAtIndex(index);
      const element = listRef.current?.getScrollableNode();
      if (row && element) {
        rememberTimelinePosition(
          listIdentityKey,
          {
            ...position,
            offsetWithinRow: element.getBoundingClientRect().top - row.getBoundingClientRect().top,
            scrollOffset: element.scrollTop,
            atEnd: isAtEnd,
            disclosures: {
              runs: paintedExpandedRunIds,
              workGroups: paintedExpandedWorkGroupIds,
              attempts: paintedExpandedAttemptIds,
              workGroupState: workGroupViewState,
            },
          },
          liveFollowEnabled && !anchoredEndSpace,
        );
      }
    }
    if (isAtEnd !== undefined && !citationPositioning) {
      onIsAtEndChange(isAtEnd);
    }
    reportContentOverflow();
    scheduleMinimapRefresh();
  };

  const handleItemSizeChanged = () => {
    reportContentOverflow();
    scheduleMinimapRefresh();
  };

  useEffect(
    () => () => {
      if (minimapRefreshFrameRef.current !== null) {
        cancelAnimationFrame(minimapRefreshFrameRef.current);
        minimapRefreshFrameRef.current = null;
      }
    },
    [minimapRefreshFrameRef],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(handleScroll);
    return () => cancelAnimationFrame(frame);
  }, [handleScroll]);

  const savedLiveFollowEnabledRef = useRef(liveFollowEnabled);
  useLayoutEffect(() => {
    const wasFollowing = savedLiveFollowEnabledRef.current;
    savedLiveFollowEnabledRef.current = liveFollowEnabled;
    if (wasFollowing && !liveFollowEnabled) handleScroll();
  }, [handleScroll, liveFollowEnabled]);

  useEffect(() => {
    if (!timelineViewportElement) {
      return;
    }

    const measure = () => {
      const viewportWidth = timelineViewportElement.getBoundingClientRect().width;
      const contentWidth =
        timelineViewportElement
          .querySelector<HTMLElement>("[data-timeline-root]")
          ?.getBoundingClientRect().width ?? viewportWidth;
      const nextHasPersistentGutter = resolveTimelineMinimapHasPersistentGutter(
        viewportWidth,
        contentWidth,
      );
      setMinimapHasPersistentGutter((current) =>
        current === nextHasPersistentGutter ? current : nextHasPersistentGutter,
      );
      setMinimapHitStripWidth(resolveTimelineMinimapHitStripWidth(viewportWidth, contentWidth));
      reportContentOverflow();
    };

    const frame = requestAnimationFrame(measure);

    const stopObserving = observeResize(timelineViewportElement, measure);

    return () => {
      cancelAnimationFrame(frame);
      stopObserving();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- rows.length and layout inputs trigger a re-measure; the effect reads them through the DOM
  }, [timelineViewportElement, rows.length, reportContentOverflow, chatWidth]);

  const sharedState: TimelineRowSharedState = {
    pendingApprovals: pendingApprovalsByRequestId,
    respondingRequestIds,
    canOperateThread,
    onRespondToApproval,
    citationRequest: readyCitationRequest,
    listRef,
    timestampFormat,
    routeThreadKey,
    threadRef: citationThreadRef,
    markdownCwd,
    resolvedTheme,
    workspaceRoot,
    skills,
    runs,
    activeThreadEnvironmentId,
    onRevertToTurnCount,
    onRunShellCommand,
    findActive,
    onImageExpand,
    onFileOpen,
    onUseArtifactTemplate,
    onSendAppMessage,
    onAppFullscreenChange,
    onFileDownload,
    openPullRequest,
    onOpenTurnDiff,
    renderHtmlRender,
    turnItemSource,
    onOpenThread,
    workflowOpening,
    onForkFromRun,
    pinnedItemIds,
    onTogglePinnedMessage: onTogglePinnedMessage ?? null,
    onToggleTurnFold,
    onToggleAttemptFold,
    onToggleWorkGroup,
    onToggleWorkEntry: suspendEndScrollMaintenanceForDisclosure,
    onCancelWorktreeSetup: onCancelWorktreeSetup ?? null,
    retryableWorkspacePreparationRunIds,
    onRetryWorkspacePreparation: onRetryWorkspacePreparation ?? null,
    onWorktreeSetupWorkLocally: onWorktreeSetupWorkLocally ?? null,
    onOpenWorktreeSetupTerminal: onOpenWorktreeSetupTerminal ?? null,
    workGroupViewState,
  };
  const compactionAwaitingRow =
    isCompacting &&
    !rows.some(
      (row) =>
        (row.kind === "context-compaction" && row.active) ||
        (row.kind === "working" && row.compacting),
    );
  const backgroundWorktreeSetup =
    worktreeSetup !== null &&
    worktreeSetup.phase === "running" &&
    worktreeSetupAgentStarted(worktreeSetup) &&
    latestRun?.startedAt != null
      ? worktreeSetup
      : null;
  const activityState: TimelineRowActivityState = {
    isWorking,
    isCompacting: compactionAwaitingRow,
    isRevertingCheckpoint,
    backgroundWorktreeSetup,
    activeTurnInProgress,
    awaitingUser,
    isPreparingWorktree,
    latestRunId: latestRun?.runId ?? null,
  };
  const listHeaderLeadingContent =
    parentThreadLink === null ? (
      topFadeEnabled ? (
        TIMELINE_LIST_FADE_HEADER
      ) : (
        TIMELINE_LIST_HEADER
      )
    ) : (
      <div className="messages-timeline-row-frame">
        <div className="chat-content-lane pt-1 sm:pt-2">
          <TimelineSystemDivider
            label="Subagent of"
            detail={parentThreadLink.title}
            icon={BotIcon}
            actionLabel="Open parent thread"
            onAction={() => onOpenThread(parentThreadLink.threadId)}
          />
        </div>
      </div>
    );
  const listHeader = (
    <>
      {parentThreadLink === null ? listHeaderLeadingContent : null}
      {historyControls ? <TimelineHistoryControl {...historyControls} /> : null}
      {parentThreadLink !== null ? listHeaderLeadingContent : null}
    </>
  );

  const canvas = useChatCanvas();
  const registerTimeline = canvas?.registerTimeline;
  const isPaneInputOwner = usePaneInputOwner();
  const setTimelineList = useStableCallback((list: LegendListRef | null) => {
    listRef.current = list;
    const scrollNode = list?.getScrollableNode() ?? null;
    registerTimeline?.(scrollNode);
    const viewport = scrollNode ? attachTimelineViewport(scrollNode, isPaneInputOwner) : null;
    viewportRef.current = viewport;
    const detach = viewport ? onViewportAttach?.(viewport) : undefined;
    return () => {
      detach?.();
      viewport?.dispose();
      if (viewportRef.current === viewport) viewportRef.current = null;
      registerTimeline?.(null);
      if (listRef.current === list) listRef.current = null;
    };
  });
  const endFollowAllowed = !(
    citationPositioning ||
    (restoringThreadPosition && rememberedPosition?.atEnd === false) ||
    anchoredEndSpace ||
    !liveFollowEnabled
  );
  useLayoutEffect(() => {
    endFollowAllowedRef.current = endFollowAllowed;
  }, [endFollowAllowed]);

  useThreadFindPositionReader({
    threadKey: routeThreadKey,
    findPositionReaderRef,
    timelineViewportElement,
    findFoldRunIds,
    timelineEntries,
    latestRun,
    runningRunId,
    isWorking,
    runlessWorkActive,
    rows,
    contentInsetEndAdjustment,
  });

  useTimelineMessageJump({
    jump: messageJump,
    entries: timelineEntries,
    rows,
    listReady: findListReady,
    historyControls,
    handlers: {
      start: onManualNavigation,
      scroll: (index) => {
        void listRef.current?.scrollToIndex({
          index,
          animated: !prefersReducedMotion,
          viewOffset: 24,
        });
      },
      unfold: (messageId) => {
        const entry = timelineEntries.find(
          (candidate) => candidate.kind === "message" && candidate.message.id === messageId,
        );
        if (!entry) return;
        const runId = turnFoldRunIdOf(entry.id);
        if (runId) expandCitedRun(runId);
        const attemptId = entry.attempt?.id;
        if (attemptId) {
          setExpandedAttemptIds((previous) =>
            previous.has(attemptId) ? previous : new Set(previous).add(attemptId),
          );
        }
      },
      loadEarlier: (messageId) => historyControls?.onLoadEarlier(messageId),
      fail: onMessageJumpFailed,
    },
  });

  useThreadFindNavigation({
    listReady: findListReady,
    historyControls,
    entries: timelineEntries,
    container: timelineViewportElement,
    query: normalizedFindQuery,
    match: activeFindMatch,
    navigationId: findNavigationId,
    rowIndex: activeFindMatch ? rows.findIndex((row) => row.id === activeFindMatch.entryId) : -1,
    listRef,
    contentInsetEndAdjustment,
  });

  // Each row carries its own provider. LegendList moves rows into their
  // containers one commit after this component renders, so a provider around
  // the list would re-render the outgoing thread's rows with the incoming
  // thread's context just before they unmount. extraData hands a changed
  // sharedState to the rows that stay.
  const onAudioPlaybackChange = (rowId: string, event: SyntheticEvent) => {
    const audio = event.target;
    if (!(audio instanceof HTMLAudioElement)) return;
    setPlayingAudioRows((current) => {
      const playing = !audio.paused && !audio.ended;
      if (playing === current.has(audio)) return current;
      const next = new Map(current);
      if (playing) next.set(audio, rowId);
      else next.delete(audio);
      return next;
    });
  };
  const onAudioUnmount = useStableCallback((audio: HTMLAudioElement) => {
    setPlayingAudioRows((current) => {
      if (!current.has(audio)) return current;
      const next = new Map(current);
      next.delete(audio);
      return next;
    });
  });
  const renderItem = ({ item }: { item: MessagesTimelineRow }) => (
    <TimelineRowCtx value={sharedState}>
      <div
        className="messages-timeline-row-frame"
        onPlayCapture={(event) => onAudioPlaybackChange(item.id, event)}
        onPauseCapture={(event) => onAudioPlaybackChange(item.id, event)}
        onEndedCapture={(event) => onAudioPlaybackChange(item.id, event)}
      >
        <div
          className="@container/chat-lane chat-content-lane overflow-x-clip"
          data-timeline-root="true"
        >
          <TimelineRowPreviewHost rowId={item.id}>
            <AudioPreviewUnmountContext value={onAudioUnmount}>
              <TimelineRowContent row={item} />
            </AudioPreviewUnmountContext>
          </TimelineRowPreviewHost>
        </div>
      </div>
    </TimelineRowCtx>
  );
  const listExtraData = { identity: listIdentityKey, rowCount: rows.length, sharedState };
  const timelineListFooter = (
    <TimelineListFooter
      composerInset={anchoredEndSpace ? 0 : contentInsetEndAdjustment}
      onGrow={onFooterGrow}
    >
      {footer}
      {unmatchedPendingApprovals.size > 0 ? (
        <TimelineRowCtx value={sharedState}>
          <div className="messages-timeline-row-frame">
            <div
              className="@container/chat-lane chat-content-lane overflow-x-clip"
              data-timeline-root="true"
            >
              <WorkLogBlock>
                {[...unmatchedPendingApprovals.values()].map((approval) => (
                  <TimelinePendingApprovalRow key={approval.requestId} approval={approval} />
                ))}
              </WorkLogBlock>
            </div>
          </div>
        </TimelineRowCtx>
      ) : null}
    </TimelineListFooter>
  );

  const forwardMinimapWheel = (event: WheelEvent) => {
    const scrollNode = listRef.current?.getScrollableNode();
    if (scrollNode) forwardWheelToTimeline(event, scrollNode);
  };

  if (timelineEntries.length === 0 && loading) {
    return <ThreadTimelineLoading bottomInset={contentInsetEndAdjustment} />;
  }

  if (
    rows.length === 0 &&
    !isWorking &&
    parentThreadLink === null &&
    historyControls === undefined &&
    footer === null
  ) {
    if (hideEmptyPlaceholder) {
      return <div className="h-full min-h-0 bg-background" data-timeline-loading="true" />;
    }
    return (
      <div
        className="flex h-full items-center justify-center ps-(--chat-lane-inset-start) pe-(--chat-lane-inset-end)"
        style={{ paddingBottom: emptyPlaceholderInset }}
      >
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <MarkdownFindContext value={findActive}>
      <TimelineRowActivityCtx value={activityState}>
        <TimelineDisclosureContext value={onDisclosureToggle}>
          <TooltipScrollDismissArea
            ref={setTimelineViewportElement}
            className="relative h-full min-h-0"
            data-assistant-citation-viewport="true"
          >
            {onCiteAssistantText && citationThreadRef ? (
              <AssistantSelectionToolbar
                viewport={timelineViewportElement}
                threadRef={citationThreadRef}
                onCite={onCiteAssistantText}
              />
            ) : null}
            <LegendList<MessagesTimelineRow>
              ref={setTimelineList}
              data={rows}
              extraData={listExtraData}
              keyExtractor={keyExtractor}
              getItemType={getItemType}
              renderItem={renderItem}
              estimatedItemSize={90}
              initialScrollAtEnd={
                !findActive && citationRequest === null && rememberedPosition?.atEnd !== false
              }
              // Legend needs a data refresh to mount new pins without a scroll event.
              dataVersion={`${readyCitationRequest?.key ?? listIdentityKey}:${alwaysRenderKeys.join(",")}`}
              {...(alwaysRender ? { alwaysRender } : {})}
              onLoad={handleListLoad}
              {...(anchoredEndSpace ? { anchoredEndSpace } : {})}
              contentInsetEndAdjustment={anchoredEndSpace ? contentInsetEndAdjustment : 0}
              maintainScrollAtEnd={
                citationPositioning ||
                (restoringThreadPosition && rememberedPosition?.atEnd === false) ||
                anchoredEndSpace ||
                !liveFollowEnabled ||
                fullscreenAppRowId !== null ||
                disclosureToggleSettling
                  ? false
                  : isWorking && !prefersReducedMotion && settlingListIdentity === null
                    ? TIMELINE_MAINTAIN_SCROLL_AT_END_SMOOTH
                    : TIMELINE_MAINTAIN_SCROLL_AT_END
              }
              maintainVisibleContentPosition={
                findActive ||
                citationPositioning ||
                (restoringThreadPosition && rememberedPosition?.atEnd === false)
                  ? false
                  : maintainVisibleContentPosition
              }
              maintainScrollAtEndThreshold={1}
              onScroll={handleScroll}
              onStartReached={handleHistoryPrefetch}
              onStartReachedThreshold={THREAD_HISTORY_PREFETCH_VIEWPORTS}
              onItemSizeChanged={handleItemSizeChanged}
              className={cn(
                "messages-timeline-scroll scrollbar-gutter-both h-full min-h-0 overflow-x-hidden overscroll-y-contain [overflow-anchor:none]",
                topFadeEnabled && "topbar-scroll-fade",
              )}
              ListHeaderComponent={listHeader}
              ListFooterComponent={timelineListFooter}
            />
            <TimelineMinimap
              items={minimapItems}
              hasPersistentGutter={minimapHasPersistentGutter}
              hitStripWidth={minimapHitStripWidth}
              currentIndex={minimapCurrentIndex}
              stripMap={minimapStripMap}
              onWheel={forwardMinimapWheel}
              onSelect={(item) => {
                onManualNavigation();
                void listRef.current?.scrollToIndex({
                  index: item.rowIndex,
                  animated: !prefersReducedMotion,
                  viewOffset: 24,
                });
              }}
            />
          </TooltipScrollDismissArea>
        </TimelineDisclosureContext>
      </TimelineRowActivityCtx>
    </MarkdownFindContext>
  );
});

function TimelineHistoryControl(props: MessagesTimelineHistoryControls) {
  if (!props.loading && props.error === null) {
    return null;
  }
  return (
    <div className="messages-timeline-row-frame">
      <div className="chat-content-lane flex flex-col gap-1.5 pb-2">
        {props.loading ? (
          <p role="status" className="py-1.5 text-center text-xs text-muted-foreground/60">
            Loading earlier activity…
          </p>
        ) : null}
        {!props.loading && props.hasMoreHistory ? (
          <button
            type="button"
            aria-label="Retry loading earlier activity"
            onClick={() => props.onLoadEarlier()}
            className="flex w-full cursor-pointer items-center gap-3 py-1.5 text-muted-foreground text-xs hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
            <span className="shrink-0">Retry loading earlier activity</span>
            <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
          </button>
        ) : null}
        {props.error !== null ? (
          <p role="status" className="text-center text-muted-foreground text-xs">
            {props.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function keyExtractor(item: MessagesTimelineRow) {
  return item.id;
}

function getItemType(item: MessagesTimelineRow) {
  if (item.kind !== "message") return item.kind;
  const lengthBucket = Math.max(0, Math.floor(Math.log2(item.message.text.length / 1000)));
  return `message:${item.message.role}:${lengthBucket}`;
}

const TimelineRowContent = memo(function TimelineRowContent({ row }: { row: TimelineRow }) {
  const isExpandedToolGroup = row.kind === "work" && row.isExpandedToolGroup;
  const isSubagentGroup = row.kind === "event" && row.projectedItem.item.type === "subagent";
  const isWorkLogRow =
    row.kind === "work" ||
    row.kind === "work-live" ||
    row.kind === "work-toggle" ||
    row.kind === "thinking";
  const isExpandedToolGroupHeader =
    (row.kind === "work-toggle" || row.kind === "work-live" || row.kind === "thinking") &&
    row.expanded === true;

  return (
    <div
      className={cn(
        isWorkLogRow || isSubagentGroup || row.kind === "working"
          ? undefined
          : row.kind === "turn-fold"
            ? "pb-1.5"
            : (row.kind === "message" &&
                  row.message.role === "assistant" &&
                  !row.showAssistantMeta) ||
                row.kind === "worktree-setup" ||
                row.kind === "event" ||
                row.kind === "attempt-fold" ||
                row.kind === "html-render" ||
                row.kind === "mcp-app"
              ? "pb-2"
              : "pb-4",
        (row.kind === "message" && row.message.role === "assistant") ||
          row.kind === "assistant-meta"
          ? "group/assistant"
          : null,
      )}
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={
        row.kind === "message" || row.kind === "assistant-meta" ? row.message.id : undefined
      }
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {isWorkLogRow ? (
        <WorkLogBlock
          continues={row.continuesWorkLog}
          layout={
            isExpandedToolGroup
              ? "group-content"
              : isExpandedToolGroupHeader
                ? "group-header"
                : "standalone"
          }
        >
          {row.kind === "work" ? (
            <WorkGroupSection
              anchorKey={row.id}
              groupedEntries={row.groupedEntries}
              isExpandedToolGroup={row.isExpandedToolGroup}
              displayLabel={row.displayLabel}
            />
          ) : null}
          {row.kind === "work-live" ? <LiveWorkEntryTimelineRow row={row} /> : null}
          {row.kind === "work-toggle" ? <WorkGroupToggleTimelineRow row={row} /> : null}
          {row.kind === "thinking" ? <ThinkingTimelineRow row={row} /> : null}
        </WorkLogBlock>
      ) : null}
      {row.kind === "turn-fold" ? <TurnFoldTimelineRow key={row.id} row={row} /> : null}
      {row.kind === "attempt-fold" ? <AttemptFoldTimelineRow row={row} /> : null}
      {row.kind === "context-compaction" ? <ContextCompactionTimelineRow row={row} /> : null}
      {row.kind === "message" && row.message.role === "user" ? <UserMessageRow row={row} /> : null}
      {row.kind === "message" && row.message.role === "assistant" ? (
        <AssistantTimelineRow row={row} />
      ) : null}
      {row.kind === "assistant-meta" ? <AssistantMetaTimelineRow row={row} /> : null}
      {row.kind === "proposed-plan" ? <ProposedPlanTimelineRow row={row} /> : null}
      {row.kind === "html-render" ? <HtmlRenderTimelineRow row={row} /> : null}
      {row.kind === "mcp-app" ? <McpAppTimelineRow row={row} /> : null}
      {row.kind === "working" ? <WorkingTimelineRow row={row} /> : null}
      {row.kind === "worktree-setup" ? <WorktreeSetupTimelineRow row={row} /> : null}
      {row.kind === "event" ? <V2EventTimelineRow row={row} /> : null}
    </div>
  );
});

function WorktreeSetupTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "worktree-setup" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const terminalId = row.snapshot.setupScript?.terminalId ?? null;
  const openTerminal = ctx.onOpenWorktreeSetupTerminal;
  const onOpenTerminal = openTerminal && terminalId ? () => openTerminal(terminalId) : null;
  return (
    <WorktreeSetupCard
      snapshot={row.snapshot}
      embedded={row.embedded}
      onCancel={row.embedded ? null : ctx.onCancelWorktreeSetup}
      onWorkLocally={
        !row.embedded && row.snapshot.phase === "running" ? ctx.onWorktreeSetupWorkLocally : null
      }
      onOpenTerminal={onOpenTerminal}
    />
  );
}

function ContextCompactionTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "context-compaction" }>;
}) {
  const label =
    row.title && row.label.startsWith("Context compacted")
      ? row.title + row.label.slice("Context compacted".length)
      : row.label;
  const content = (
    <span className="flex min-w-0 items-center gap-1.5">
      {row.failed ? (
        <CircleAlertIcon aria-hidden="true" className="size-3 shrink-0" />
      ) : (
        <ShrinkIcon aria-hidden="true" className="size-3" />
      )}
      {row.tokenCounts ? (
        <>
          {row.title ?? "Context compacted"} {row.tokenCounts.before}
          <ArrowRightIcon aria-hidden="true" className="size-3" />
          {row.tokenCounts.after} tokens
        </>
      ) : (
        label
      )}
      {row.failure ? (
        <span className="min-w-0 truncate opacity-80">&middot; {row.failure}</span>
      ) : null}
    </span>
  );
  return (
    <div
      role="separator"
      aria-label={row.failure ? `${label}: ${row.failure}` : label}
      className={cn(
        "mx-auto flex w-full max-w-(--chat-content-max-width) items-center gap-3 py-1 text-xs",
        row.failed ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <span className={cn("h-px flex-1", row.failed ? "bg-destructive/30" : "bg-border/70")} />
      <span className="relative min-w-0 overflow-hidden">{content}</span>
      <span className={cn("h-px flex-1", row.failed ? "bg-destructive/30" : "bg-border/70")} />
    </div>
  );
}

function WorkHistorySkeleton() {
  return (
    <div role="status" aria-label="Loading work history" className="space-y-2 px-1 pb-1 pt-3">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-2" aria-hidden="true">
          <Skeleton className="size-3 shrink-0" />
          <Skeleton
            shape="pill"
            className={index === 0 ? "h-2.5 w-2/5" : index === 1 ? "h-2.5 w-3/5" : "h-2.5 w-1/3"}
          />
        </div>
      ))}
    </div>
  );
}

function TurnFoldTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "turn-fold" }> }) {
  const ctx = use(TimelineRowCtx);
  const { loading, error, toggle } = useDeferredWorkLoading(
    parseScopedThreadKey(ctx.routeThreadKey),
    row,
    () => ctx.onToggleTurnFold(row.runId),
  );

  return (
    <div className="group/timeline-row border-b border-border/60 pb-2 pe-0.5 pt-1">
      <div className="relative flex items-center gap-1">
        <button
          type="button"
          aria-expanded={row.expanded}
          data-scroll-anchor-ignore
          onClick={toggle}
          aria-busy={loading}
          className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-sm leading-relaxed text-muted-foreground tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          <span>
            {row.label}
            {error ? ` · ${error}` : ""}
          </span>
          <MorphIcon className="size-3.5" icon={row.expanded ? ChevronDown : ChevronRight} />
        </button>
        <TimelineRowTimestamp
          createdAt={row.createdAt}
          timestampFormat={ctx.timestampFormat}
          className="ms-auto"
        />
      </div>
      {loading ? <WorkHistorySkeleton /> : null}
    </div>
  );
}

function AttemptFoldTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "attempt-fold" }> }) {
  const ctx = use(TimelineRowCtx);
  const { loading, error, toggle } = useDeferredWorkLoading(
    parseScopedThreadKey(ctx.routeThreadKey),
    row,
    () => ctx.onToggleAttemptFold(row.attemptId),
  );

  return (
    <div>
      <button
        type="button"
        aria-expanded={row.expanded}
        data-scroll-anchor-ignore
        data-superseded-attempt-id={row.attemptId}
        onClick={toggle}
        aria-busy={loading}
        className="flex w-full cursor-pointer select-none items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <MorphIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          icon={row.expanded ? ChevronDown : ChevronRight}
        />
        <span className="text-xs font-medium text-foreground/80">
          {row.label}
          {error ? ` · ${error}` : ""}
        </span>
        <span className="text-2xs text-muted-foreground">Cut off by a steer</span>
      </button>
      {loading ? <WorkHistorySkeleton /> : null}
    </div>
  );
}

function TimelineRowPreviewHost({ rowId, children }: { rowId: string; children: ReactNode }) {
  const { onAppFullscreenChange } = use(TimelineRowCtx);
  const reportOpen = (open: boolean) => onAppFullscreenChange(rowId, open);
  return <ExpandedPreviewHostContext value={reportOpen}>{children}</ExpandedPreviewHostContext>;
}
