import type { OrchestrationV2TurnItem, ThreadId, ThreadPinnedMessage } from "@supaterm/contracts";
import { replaceComposerContextReferences } from "@supaterm/shared/composerContextReferences";
import * as DateTime from "effect/DateTime";

const PREVIEW_LENGTH = 160;
const LEADING_MARKDOWN = /^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/;
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const INLINE_MARKERS = /\*\*|__|`/g;

type PinnableMessageItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "user_message" | "assistant_message" }
>;

export function isPinnableMessageItem(item: OrchestrationV2TurnItem): item is PinnableMessageItem {
  return item.type === "user_message" || item.type === "assistant_message";
}

function pinnedMessagePreview(text: string): string {
  const plain = replaceComposerContextReferences(text, (reference) => reference.label);
  for (const line of plain.split("\n")) {
    const preview = line
      .replace(LEADING_MARKDOWN, "")
      .replace(MARKDOWN_LINK, "$1")
      .replace(INLINE_MARKERS, "")
      .replace(/\s+/g, " ")
      .trim();
    if (preview === "") continue;
    return preview.length > PREVIEW_LENGTH
      ? `${preview.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`
      : preview;
  }
  return "";
}

export function pinnedMessageOf(
  item: PinnableMessageItem,
  sourceThreadId: ThreadId,
): ThreadPinnedMessage {
  return {
    itemId: item.id,
    messageId: item.messageId,
    sourceThreadId,
    role: item.type === "user_message" ? "user" : "assistant",
    preview: pinnedMessagePreview(item.text),
    sentAt: DateTime.formatIso(item.startedAt ?? item.updatedAt),
  };
}

export function withPinnedMessage(
  pins: ReadonlyArray<ThreadPinnedMessage>,
  pin: ThreadPinnedMessage,
): ReadonlyArray<ThreadPinnedMessage> {
  return [...pins.filter((existing) => existing.itemId !== pin.itemId), pin].toSorted(
    (left, right) => left.sentAt.localeCompare(right.sentAt),
  );
}
