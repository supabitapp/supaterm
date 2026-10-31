import type { MessageId, ThreadPinnedMessage } from "@supaterm/contracts";
import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import type { TimelineEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

export interface TimelineMinimapItem {
  readonly id: string;
  readonly rowIndex: number;
  readonly userText: string | null;
  readonly assistantText: string | null;
  /** The turn's first pinned message, which may be its prompt. */
  readonly pin: ThreadPinnedMessage | null;
}

export function deriveTimelineMinimapItems(
  rows: ReadonlyArray<MessagesTimelineRow>,
  entries: ReadonlyArray<TimelineEntry>,
  pinnedMessages: ReadonlyArray<ThreadPinnedMessage>,
): TimelineMinimapItem[] {
  const turnPins = resolveTurnPins(entries, pinnedMessages);
  const items: TimelineMinimapItem[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message" || row.message.role !== "user") {
      continue;
    }

    const turnPin = turnPins.get(row.message.id);
    items.push({
      id: row.id,
      rowIndex: index,
      userText: row.message.text,
      assistantText:
        turnPin?.message.role === "assistant"
          ? turnPin.message.text
          : resolveFinalAssistantTextForTurn(rows, index),
      pin: turnPin?.pin ?? null,
    });
  }
  return items;
}

// Reads entries rather than rows because a collapsed turn fold hides the
// replies before its final one, and those can be pinned too.
function resolveTurnPins(
  entries: ReadonlyArray<TimelineEntry>,
  pinnedMessages: ReadonlyArray<ThreadPinnedMessage>,
) {
  const turnPins = new Map<MessageId, { pin: ThreadPinnedMessage; message: ChatMessage }>();
  if (pinnedMessages.length === 0) return turnPins;
  const pinsByMessageId = new Map(pinnedMessages.map((pin) => [pin.messageId, pin]));
  let promptId: MessageId | null = null;
  for (const entry of entries) {
    if (entry.kind !== "message") continue;
    if (entry.message.role === "user") promptId = entry.message.id;
    const pin = pinsByMessageId.get(entry.message.id);
    if (pin && promptId !== null && !turnPins.has(promptId)) {
      turnPins.set(promptId, { pin, message: entry.message });
    }
  }
  return turnPins;
}

function resolveFinalAssistantTextForTurn(
  rows: ReadonlyArray<MessagesTimelineRow>,
  userRowIndex: number,
) {
  let finalAssistantText: string | null = null;
  for (let index = userRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message") {
      continue;
    }
    if (row.message.role === "user") {
      break;
    }
    if (row.message.role === "assistant") {
      finalAssistantText = row.message.text ?? null;
    }
  }
  return finalAssistantText;
}

const markdownPreviewParser = unified().use(remarkParse).use(remarkGfm).freeze();

const INLINE_PARENT_TYPES = new Set<Nodes["type"]>([
  "paragraph",
  "heading",
  "tableCell",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
]);

function markdownNodeText(node: Nodes): string {
  if (node.type === "html") {
    return node.value
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(/<\/?([a-z][\w-]*)(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, (_, tag: string) =>
        /^(?:address|article|aside|blockquote|br|dd|details|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|th|thead|tr|ul)$/i.test(
          tag,
        )
          ? " "
          : "",
      );
  }
  if (node.type === "break") return " ";
  if ("value" in node) return node.value;
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if (!("children" in node)) return "";
  const separator = INLINE_PARENT_TYPES.has(node.type) ? "" : " ";
  return node.children.map(markdownNodeText).join(separator);
}

function compactMinimapPreview(text: string | null | undefined) {
  const compact = text?.replace(/\s+/g, " ").trim() ?? "";
  return compact.length > 0 ? compact : null;
}

export function resolveTimelineMinimapPreview(
  item: TimelineMinimapItem | null,
): TimelineMinimapItem | null {
  return item === null
    ? null
    : {
        ...item,
        userText: compactMinimapPreview(item.userText),
        // The tooltip shows three lines; bound parsing work while long responses stream.
        assistantText: compactMinimapPreview(
          item.assistantText === null
            ? null
            : markdownNodeText(markdownPreviewParser.parse(item.assistantText.slice(0, 1_500))),
        ),
      };
}
