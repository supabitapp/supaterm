import {
  createMessageJumpRunner,
  type MessageJump,
  type MessageJumpHandlers,
} from "@supaterm/client-runtime/message-jump";
import type { ThreadHistoryControls } from "@supaterm/client-runtime/thread-history-prefetch";
import { useEffect, useState } from "react";
import type { TimelineEntry } from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

export function useTimelineMessageJump({
  jump,
  entries,
  rows,
  listReady,
  historyControls,
  handlers,
}: {
  jump: MessageJump | null;
  entries: ReadonlyArray<TimelineEntry>;
  rows: ReadonlyArray<MessagesTimelineRow>;
  listReady: boolean;
  historyControls: ThreadHistoryControls | undefined;
  handlers: MessageJumpHandlers;
}) {
  const [advance] = useState(createMessageJumpRunner);
  useEffect(() => {
    if (!jump || !listReady) return;
    advance(
      jump,
      {
        rowIndex: rows.findIndex(
          (row) => row.kind === "message" && row.message.id === jump.messageId,
        ),
        loaded: entries.some(
          (entry) => entry.kind === "message" && entry.message.id === jump.messageId,
        ),
        cursor: entries[0]?.id ?? "first",
        history: historyControls,
      },
      handlers,
    );
  }, [advance, entries, handlers, historyControls, jump, listReady, rows]);
}
