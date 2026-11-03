import { isCompactionCommandMessage } from "@supaterm/contracts";
import { threadHasCaughtUpTo } from "@supaterm/client-runtime/state/threads";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import { finalizeThreadFeedPresentation, type ThreadFeedEntry } from "../../lib/threadActivity";
import { resolveUserMessageGrouping } from "@supaterm/client-runtime/user-message";
import type {
  AcknowledgedThreadMessage,
  QueuedThreadMessage,
} from "../../state/thread-outbox-model";
import { scopedThreadKey } from "../../lib/scopedEntities";

export type PendingThreadFeedEntry = ThreadFeedEntry & {
  readonly pendingMessage?: QueuedThreadMessage;
  readonly acknowledged?: boolean;
  readonly draftAttachments?: ReadonlyArray<DraftComposerAttachment>;
};

// An acknowledged row stops being pending once the thread catches up to it,
// even when the feed hides that message (a rolled-back or cancelled run).
export function selectPendingAcknowledgedMessages(
  acknowledged: ReadonlyArray<AcknowledgedThreadMessage>,
  thread: {
    readonly threadKey: string | null;
    readonly queuedMessages: ReadonlyArray<QueuedThreadMessage>;
    readonly sequence: number;
    readonly projectedMessages: ReadonlyArray<{ readonly id: string }> | undefined;
  },
): ReadonlyArray<AcknowledgedThreadMessage> {
  return acknowledged.filter(
    (message) =>
      scopedThreadKey(message.environmentId, message.threadId) === thread.threadKey &&
      !thread.queuedMessages.some((queued) => queued.messageId === message.messageId) &&
      !threadHasCaughtUpTo(message, {
        sequence: thread.sequence,
        messages: thread.projectedMessages,
      }),
  );
}

export function retainPendingCreationAttachments(
  feed: ReadonlyArray<ThreadFeedEntry>,
  pendingMessage: QueuedThreadMessage | null,
  queued = false,
): ReadonlyArray<PendingThreadFeedEntry> {
  if (!pendingMessage) return feed;
  return feed.map((entry) =>
    entry.type === "message" && entry.message.id === pendingMessage.messageId
      ? {
          ...entry,
          draftAttachments: pendingMessage.attachments,
          ...(queued ? { pendingMessage } : {}),
        }
      : entry,
  );
}

export type GroupedThreadFeedRow = PendingThreadFeedEntry & {
  readonly userMessageGrouping: ReturnType<typeof resolveUserMessageGrouping>;
};

export function createThreadFeedGrouping() {
  const rows = new WeakMap<PendingThreadFeedEntry, GroupedThreadFeedRow>();
  const ungrouped = resolveUserMessageGrouping(undefined, undefined, undefined);
  return (
    feed: ReadonlyArray<PendingThreadFeedEntry>,
    options: { readonly workflowOpeningMessageId?: string; readonly setupAnchorIndex?: number },
  ): ReadonlyArray<GroupedThreadFeedRow> => {
    const groupingMessage = (index: number) => {
      const entry = feed[index];
      return entry?.type === "message" &&
        entry.message.role === "user" &&
        !isCompactionCommandFeedEntry(entry) &&
        entry.message.id !== options.workflowOpeningMessageId
        ? entry.message
        : undefined;
    };
    return feed.map((entry, index) => {
      const message = groupingMessage(index);
      const grouping =
        message === undefined
          ? ungrouped
          : resolveUserMessageGrouping(
              message,
              index - 1 === options.setupAnchorIndex ? undefined : groupingMessage(index - 1),
              index === options.setupAnchorIndex ? undefined : groupingMessage(index + 1),
            );
      const previous = rows.get(entry);
      if (
        previous?.userMessageGrouping.groupedWithPrevious === grouping.groupedWithPrevious &&
        previous.userMessageGrouping.groupedWithNext === grouping.groupedWithNext
      )
        return previous;
      const row = { ...entry, userMessageGrouping: grouping };
      rows.set(entry, row);
      return row;
    });
  };
}

export function appendPendingThreadMessages(
  presentedFeed: ReadonlyArray<ThreadFeedEntry>,
  feed: ReadonlyArray<ThreadFeedEntry>,
  queuedMessages: ReadonlyArray<QueuedThreadMessage>,
): ReadonlyArray<PendingThreadFeedEntry> {
  if (queuedMessages.length === 0) return presentedFeed;
  const deliveredIds = new Set(
    feed.flatMap((entry) => (entry.type === "message" ? [entry.message.id] : [])),
  );
  return finalizeThreadFeedPresentation([
    ...presentedFeed.map((entry): PendingThreadFeedEntry => {
      const pendingMessage = queuedMessages.find(
        (message) => message.creation !== undefined && message.messageId === entry.id,
      );
      return pendingMessage ? { ...entry, pendingMessage, acknowledged: false } : entry;
    }),
    ...queuedMessages.flatMap((pendingMessage): PendingThreadFeedEntry[] => {
      if (deliveredIds.has(pendingMessage.messageId)) return [];
      return [
        {
          type: "message",
          id: pendingMessage.messageId,
          createdAt: pendingMessage.createdAt,
          pendingMessage,
          message: {
            id: pendingMessage.messageId,
            role: "user",
            text: pendingMessage.text,
            attachments: [],
            context: pendingMessage.context,
            createdAt: pendingMessage.createdAt,
            updatedAt: pendingMessage.createdAt,
            runId: null,
            streaming: false,
            visibility: "local",
            sourceThreadId: pendingMessage.threadId,
          },
        },
      ];
    }),
  ]);
}

export function isCompactionCommandFeedEntry(entry: PendingThreadFeedEntry): boolean {
  return (
    entry.type === "message" &&
    entry.pendingMessage === undefined &&
    isCompactionCommandMessage(entry.message)
  );
}
