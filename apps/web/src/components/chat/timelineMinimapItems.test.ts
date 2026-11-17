import { EnvironmentId, MessageId, RunId, ThreadId, TurnItemId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import { serializeAssistantCitation } from "@supaterm/shared/assistantCitations";
import {
  ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  formatComposerContextReference,
  toComposerContextId,
} from "@supaterm/shared/composerContextReferences";

import type { TimelineEntry } from "../../session-logic";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";
import { deriveTimelineMinimapItems, resolveTimelineMinimapPreview } from "./timelineMinimapItems";

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

  it.each(["", "Ultrathink:\n"])(
    "omits bootstrap text from the minimap label and tooltip (%j)",
    (prefix) => {
      const at = "2026-10-01T00:00:00Z";
      const items = deriveTimelineMinimapItems(
        [
          {
            kind: "message",
            id: "image-only",
            createdAt: at,
            showAssistantMeta: false,
            showAssistantCopyButton: false,
            assistantCopyStreaming: false,
            message: {
              id: MessageId.make("image-only"),
              role: "user",
              text: prefix + ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
              runId: null,
              streaming: false,
              createdAt: at,
              updatedAt: at,
            },
          },
        ],
        [],
        [],
      );
      expect(items).toEqual([
        { id: "image-only", rowIndex: 0, userText: "", assistantText: null, pin: null },
      ]);
      expect(resolveTimelineMinimapPreview(items[0]!)?.userText).toBeNull();
    },
  );
});

describe("resolveTimelineMinimapPreview", () => {
  it("previews a thread autolink as prose, not its URL", () => {
    const preview = resolveTimelineMinimapPreview({
      id: "turn-1",
      rowIndex: 0,
      pin: null,
      userText: null,
      assistantText:
        "Started <supaterm-thread://v2/env-1/thread-1> and [Fix CI](supaterm-thread://v2/env-1/t2).",
    });
    expect(preview?.assistantText).toBe("Started a thread and Fix CI.");
  });

  it("previews a quote, a context chip and a file link in the user's message as their text", () => {
    const quote = serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make("assistant-1"),
      text: "The cache misses on a cold start.",
      start: 0,
      end: 33,
      prefix: "",
      suffix: "",
    });
    const file = formatComposerContextReference({
      kind: "file",
      contextId: toComposerContextId("readme"),
      label: "README.md",
    });
    const preview = resolveTimelineMinimapPreview({
      id: "turn-1",
      rowIndex: 0,
      pin: null,
      userText: `${quote}\nWhere do ${file} and [math.ts](src/math.ts) cover this?`,
      assistantText: null,
    });
    expect(preview?.userText).toBe(
      "The cache misses on a cold start. Where do README.md and math.ts cover this?",
    );
  });
});
