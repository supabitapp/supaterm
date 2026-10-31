import { MessageId, RunId, ThreadId, TurnItemId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";
import { deriveTimelineMinimapItems } from "./timelineMinimapItems";

function messageEntry(
  id: string,
  role: "user" | "assistant",
  text: string,
  createdAt: string,
): TimelineEntry {
  return {
    id: `${id}-entry`,
    kind: "message",
    createdAt,
    message: {
      id: MessageId.make(id),
      role,
      text,
      runId: role === "assistant" ? RunId.make("turn-1") : null,
      createdAt,
      updatedAt: createdAt,
      streaming: false,
    },
  };
}

describe("deriveTimelineMinimapItems", () => {
  it("targets a pinned reply inside a collapsed turn and previews it", () => {
    const entries = [
      messageEntry("prompt", "user", "Build it", "2026-01-01T00:00:00Z"),
      messageEntry("plan", "assistant", "Deployment checklist", "2026-01-01T00:00:05Z"),
      messageEntry("final", "assistant", "Done", "2026-01-01T00:00:20Z"),
    ];
    const rows = deriveMessagesTimelineRows({
      timelineEntries: entries,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    });
    const pin = {
      itemId: TurnItemId.make("plan-item"),
      messageId: MessageId.make("plan"),
      sourceThreadId: ThreadId.make("thread-1"),
      role: "assistant" as const,
      preview: "Deployment checklist",
      sentAt: "2026-01-01T00:00:05Z",
    };

    expect(rows.some((row) => row.kind === "message" && row.message.id === pin.messageId)).toBe(
      false,
    );
    expect(deriveTimelineMinimapItems(rows, entries, [pin])).toEqual([
      expect.objectContaining({
        userText: "Build it",
        assistantText: "Deployment checklist",
        pin,
      }),
    ]);
  });
});
