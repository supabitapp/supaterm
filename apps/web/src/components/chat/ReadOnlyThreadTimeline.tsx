import type { LegendListRef } from "@legendapp/list/react";
import { resolveThreadWorkingStartedAt } from "@supaterm/client-runtime/state/models";
import {
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveThreadStructureRuntime,
} from "@supaterm/client-runtime/state/thread-execution";
import { createQuestionHistoryProjector } from "@supaterm/client-runtime/state/thread-requests";
import { EnvironmentId, type OrchestrationV2ThreadProjection } from "@supaterm/contracts";
import { useRef, useState, type ReactNode } from "react";

import { useTheme } from "~/hooks/useTheme";
import { createTimelineEntriesProjector, derivePhase } from "~/session-logic";
import type { TurnItemDetailSource } from "~/state/queries";

import { deriveTimelineWorking } from "../ChatView.logic";
import type { ChatComposerHandle } from "./ChatComposer";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { MessagesTimeline, type MessagesTimelineHistoryControls } from "./MessagesTimeline";
import { ScrollToEndPill } from "./ScrollToEndPill";
import type { TimelineRow } from "./timelineRowContext";
import { useTimelineFollow } from "./useTimelineFollow";

// The timeline needs an environment id to key its rows. No environment answers to this one, so a
// row that would ask the thread's environment for something gets nothing.
const NO_ENVIRONMENT_ID = EnvironmentId.make("linked-thread");
const NO_TURN_DIFFS: ReadonlyArray<never> = [];
const NO_ANCHORED_MESSAGES: ReadonlyArray<never> = [];
const ignore = () => {};

/**
 * A thread's own timeline, built from its projection alone and read-only: every action that would
 * reach the thread's environment (fork, revert, reply, pins, diffs, files, other threads, shell,
 * approvals) is left out, so its control does not render.
 */
export function ReadOnlyThreadTimeline(props: {
  /** Keys the list. It holds no ":" so the timeline finds no environment thread behind it. */
  readonly threadKey: string;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly historyControls: MessagesTimelineHistoryControls | undefined;
  /** Where expanded rows read an item's detail. */
  readonly turnItemSource: TurnItemDetailSource;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
  readonly renderHtmlRender: (row: Extract<TimelineRow, { kind: "html-render" }>) => ReactNode;
  /** What stands below the timeline, where the composer would. */
  readonly children: ReactNode;
}) {
  const { threadKey, projection } = props;
  const listRef = useRef<LegendListRef | null>(null);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const { resolvedTheme } = useTheme();
  // The rest is what ChatView derives from the same projection.
  const [projectQuestionHistory] = useState(() => createQuestionHistoryProjector());
  const [projectTimelineEntries] = useState(createTimelineEntriesProjector);
  const entries = projectTimelineEntries(
    {
      visibleTurnItems: projectQuestionHistory(projection),
      anchoredMessages: NO_ANCHORED_MESSAGES,
      attempts: projection.attempts,
      nodes: projection.nodes,
      plans: projection.plans,
    },
    threadKey,
  );
  const activityRun = deriveThreadActivityRun(projection);
  const runtime = deriveThreadStructureRuntime(projection);
  const runlessWorkStartedAt = deriveRunlessWorkStartedAt(projection);
  const isWorking = deriveTimelineWorking({
    phase: derivePhase(runtime),
    isCompacting: false,
    runlessWorkStartedAt,
  });
  const workStartedAt =
    resolveThreadWorkingStartedAt({ latestRun: activityRun, runtime }) ?? runlessWorkStartedAt;
  const runningRunId = runtime?.activeRunId ?? null;
  const follow = useTimelineFollow({
    legendListRef: listRef,
    composerRef,
    composerTimelineInset: 0,
    routeThreadKey: threadKey,
    activeThreadKey: threadKey,
    // Not a server thread: new turns follow the end instead of anchoring near the top.
    isServerThread: false,
    serverProjection: null,
    threadStatus: "live",
    activeActivityRun: activityRun,
    activeRunningTurnId: runningRunId,
    timelineEntries: entries,
    timelineAnchorMessageId: null,
    setTimelineAnchor: ignore,
  });
  return (
    <>
      <div className="relative min-h-0 flex-1">
        <MessagesTimeline
          listRef={listRef}
          timelineEntries={entries}
          isWorking={isWorking}
          activeTurnStartedAt={workStartedAt}
          latestRun={activityRun}
          runningRunId={runningRunId}
          turnDiffSummaries={NO_TURN_DIFFS}
          runs={projection.runs}
          routeThreadKey={threadKey}
          onOpenTurnDiff={ignore}
          supportsConversationRollback={false}
          onRevertToTurnCount={ignore}
          isRevertingCheckpoint={false}
          onImageExpand={props.onImageExpand}
          renderHtmlRender={props.renderHtmlRender}
          turnItemSource={props.turnItemSource}
          historyControls={props.historyControls}
          activeThreadEnvironmentId={NO_ENVIRONMENT_ID}
          markdownCwd={undefined}
          resolvedTheme={resolvedTheme}
          timestampFormat="locale"
          workspaceRoot={undefined}
          anchorMessageId={null}
          onAnchorReady={ignore}
          onAnchorSizeChanged={ignore}
          contentInsetEndAdjustment={0}
          emptyPlaceholderInset={0}
          liveFollowEnabled={follow.timelineLiveFollowEnabled}
          onIsAtEndChange={follow.onIsAtEndChangeStable}
          onViewportAttach={follow.attachTimelineViewport}
          onFooterGrow={follow.onTimelineFooterGrowStable}
          onJumpToPinnedMessage={ignore}
        />
        <ScrollToEndPill
          show={follow.showScrollToBottom}
          bottom={4}
          composerOverlay={null}
          onScrollToEnd={() => follow.scrollToEnd(true)}
        />
      </div>
      {props.children}
    </>
  );
}
