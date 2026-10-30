import type { ThreadGuestMessage, ThreadGuestShare } from "@supaterm/contracts";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import { finalizeThreadFeedPresentation, type ThreadFeedEntry } from "../../lib/threadActivity";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";

/**
 * A guest's message waiting for the owner's Send or Dismiss. It is a feed row, not the list
 * footer, so the feed follows it arriving and leaving the way it follows any row.
 */
export interface GuestPendingFeedEntry {
  readonly type: "guest-pending";
  readonly id: string;
  readonly createdAt: string;
  readonly guestName: string;
  readonly message: ThreadGuestMessage;
}

export type PendingThreadFeedEntry = ThreadFeedEntry & {
  readonly pendingMessage?: QueuedThreadMessage;
  readonly acknowledged?: boolean;
  readonly draftAttachments?: ReadonlyArray<DraftComposerAttachment>;
};

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

/** A row of the thread feed's list. */
export type ThreadFeedRow = PendingThreadFeedEntry | GuestPendingFeedEntry;

/** Waiting guest messages go after the transcript, oldest first. */
export function appendGuestPendingMessages(
  presentedFeed: ReadonlyArray<PendingThreadFeedEntry>,
  share: ThreadGuestShare | null,
): ReadonlyArray<ThreadFeedRow> {
  const pending = share?.messages.filter((message) => message.status === "pending") ?? [];
  if (share === null || pending.length === 0) return presentedFeed;
  const guestName = share.guestName ?? "Guest";
  return [
    ...presentedFeed,
    ...pending.map((message): GuestPendingFeedEntry => ({
      type: "guest-pending",
      id: `guest-pending:${message.id}`,
      createdAt: message.submittedAt,
      guestName,
      message,
    })),
  ];
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
