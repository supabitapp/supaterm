import { isCompactionCommandMessage } from "@supaterm/contracts";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import { finalizeThreadFeedPresentation, type ThreadFeedEntry } from "../../lib/threadActivity";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";
import { scopedThreadKey } from "../../lib/scopedEntities";

export type PendingThreadFeedEntry = ThreadFeedEntry & {
  readonly pendingMessage?: QueuedThreadMessage;
  readonly acknowledged?: boolean;
  readonly draftAttachments?: ReadonlyArray<DraftComposerAttachment>;
};

// An acknowledged row stops being pending once the projection holds its message,
// even when the feed hides that message (a rolled-back or cancelled run).
export function selectPendingAcknowledgedMessages(
  acknowledged: ReadonlyArray<QueuedThreadMessage>,
  thread: {
    readonly threadKey: string | null;
    readonly queuedMessages: ReadonlyArray<QueuedThreadMessage>;
    readonly projectedMessages: ReadonlyArray<{ readonly id: string }> | undefined;
  },
): ReadonlyArray<QueuedThreadMessage> {
  return acknowledged.filter(
    (message) =>
      scopedThreadKey(message.environmentId, message.threadId) === thread.threadKey &&
      !thread.queuedMessages.some((queued) => queued.messageId === message.messageId) &&
      !thread.projectedMessages?.some((projected) => projected.id === message.messageId),
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
