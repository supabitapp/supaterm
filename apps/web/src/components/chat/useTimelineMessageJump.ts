import type { LegendListRef } from "@legendapp/list/react";
import type { ThreadHistoryControls } from "@supaterm/client-runtime/thread-history-prefetch";
import type { MessageId, RunId } from "@supaterm/contracts";
import { useEffect, useRef, type RefObject } from "react";
import type { TimelineEntry } from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { toastManager } from "../ui/toast";

export interface TimelineMessageJump {
  readonly key: number;
  readonly messageId: MessageId;
}

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
}: {
  jump: TimelineMessageJump | null;
  entries: ReadonlyArray<TimelineEntry>;
  rows: ReadonlyArray<MessagesTimelineRow>;
  listRef: RefObject<LegendListRef | null>;
  listReady: boolean;
  animated: boolean;
  historyControls: ThreadHistoryControls | undefined;
  getTurnFoldRunId: (entryId: string) => RunId | undefined;
  onExpandTurn: (runId: RunId) => void;
  onManualNavigation: () => void;
}) {
  const navigationRef = useRef<{
    key: number;
    requestedPages: Set<string>;
    expandedRunId: RunId | null;
    done: boolean;
  } | null>(null);

  useEffect(() => {
    if (!jump) return;
    if (navigationRef.current?.key !== jump.key) {
      navigationRef.current = {
        key: jump.key,
        requestedPages: new Set(),
        expandedRunId: null,
        done: false,
      };
      onManualNavigation();
    }
    const navigation = navigationRef.current;
    if (navigation.done || !listReady) return;
    const fail = () => {
      navigation.done = true;
      toastManager.add({
        type: "warning",
        title: "Pinned message not found",
        description: "It may have been reverted. Unpin it from the pinned messages list.",
      });
    };
    const entry = entries.find(
      (candidate) => candidate.kind === "message" && candidate.message.id === jump.messageId,
    );
    if (!entry) {
      if (historyControls?.loading) return;
      const cursor = entries[0]?.id ?? "first";
      if (
        !historyControls?.hasMoreHistory ||
        historyControls.error !== null ||
        navigation.requestedPages.has(cursor)
      ) {
        fail();
        return;
      }
      navigation.requestedPages.add(cursor);
      historyControls.onLoadEarlier(jump.messageId);
      return;
    }
    const index = rows.findIndex(
      (row) => row.kind === "message" && row.message.id === jump.messageId,
    );
    if (index < 0) {
      const foldRunId = getTurnFoldRunId(entry.id);
      if (foldRunId === undefined || navigation.expandedRunId === foldRunId) {
        fail();
        return;
      }
      navigation.expandedRunId = foldRunId;
      onExpandTurn(foldRunId);
      return;
    }
    navigation.done = true;
    void listRef.current?.scrollToIndex({ index, animated, viewOffset: 24 });
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
    rows,
  ]);
}
