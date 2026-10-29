import type { LegendListRef } from "@legendapp/list/react";
import {
  type MessageJump,
  type MessageJumpProgress,
  nextMessageJumpStep,
} from "@supaterm/client-runtime/message-jump";
import type { ThreadHistoryControls } from "@supaterm/client-runtime/thread-history-prefetch";
import type { RunId } from "@supaterm/contracts";
import { useEffect, useRef, type RefObject } from "react";
import type { TimelineEntry } from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

export function useTimelineMessageJump({
  jump,
  entries,
  rows,
  listRef,
  listReady,
  animated,
  historyControls,
  getTurnFoldRunId,
  onExpandTurn,
  onManualNavigation,
  onMissing,
}: {
  jump: MessageJump | null;
  entries: ReadonlyArray<TimelineEntry>;
  rows: ReadonlyArray<MessagesTimelineRow>;
  listRef: RefObject<LegendListRef | null>;
  listReady: boolean;
  animated: boolean;
  historyControls: ThreadHistoryControls | undefined;
  getTurnFoldRunId: (entryId: string) => RunId | undefined;
  onExpandTurn: (runId: RunId) => void;
  onManualNavigation: () => void;
  onMissing: (jump: MessageJump) => void;
}) {
  const navigationRef = useRef<{
    key: number;
    progress: MessageJumpProgress;
    done: boolean;
  } | null>(null);

  useEffect(() => {
    if (!jump) return;
    if (navigationRef.current?.key !== jump.key) {
      navigationRef.current = {
        key: jump.key,
        progress: { requestedCursors: new Set(), expandedRunId: null },
        done: false,
      };
      onManualNavigation();
    }
    const navigation = navigationRef.current;
    if (navigation.done || !listReady) return;
    const entry = entries.find(
      (candidate) => candidate.kind === "message" && candidate.message.id === jump.messageId,
    );
    const step = nextMessageJumpStep({
      rowIndex: rows.findIndex(
        (row) => row.kind === "message" && row.message.id === jump.messageId,
      ),
      loaded: entry !== undefined,
      foldRunId: entry === undefined ? null : getTurnFoldRunId(entry.id),
      cursor: entries[0]?.id ?? "first",
      history: historyControls,
      progress: navigation.progress,
    });
    switch (step.type) {
      case "scroll":
        navigation.done = true;
        void listRef.current?.scrollToIndex({ index: step.index, animated, viewOffset: 24 });
        return;
      case "expand":
        navigation.progress = { ...navigation.progress, expandedRunId: step.runId };
        onExpandTurn(step.runId);
        return;
      case "load-earlier":
        navigation.progress = {
          ...navigation.progress,
          requestedCursors: new Set(navigation.progress.requestedCursors).add(step.cursor),
        };
        historyControls?.onLoadEarlier(jump.messageId);
        return;
      case "wait":
        return;
      case "missing":
        navigation.done = true;
        onMissing(jump);
    }
  }, [
    animated,
    entries,
    getTurnFoldRunId,
    historyControls,
    jump,
    listReady,
    listRef,
    onExpandTurn,
    onManualNavigation,
    onMissing,
    rows,
  ]);
}
