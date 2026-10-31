import { describe, expect, it } from "vite-plus/test";
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ThreadId,
} from "@supaterm/contracts";
import { deriveThreadFeedPresentation } from "../../lib/threadActivity";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";
import {
  appendPendingThreadMessages,
  isCompactionCommandFeedEntry,
  retainPendingCreationAttachments,
  selectPendingAcknowledgedMessages,
} from "./pending-thread-feed";

const pending = (id: string): QueuedThreadMessage => ({
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make(id),
  commandId: CommandId.make(id),
  text: id,
  attachments: [],
  createdAt: "2026-09-06T10:00:00.000Z",
});

describe("pending timeline messages", () => {
  it.each([false, true])(
    "keeps a queued compact command in the pending message row (attachment: %s)",
    (withAttachment) => {
      const queued = {
        ...pending("compact"),
        text: "/compact",
        attachments: withAttachment
          ? [
              {
                id: "image-1",
                type: "image" as const,
                name: "photo.png",
                mimeType: "image/png",
                sizeBytes: 3,
                fileUri: "file:///documents/photo.png",
                previewUri: "file:///documents/photo.png",
              },
            ]
          : [],
      };
      const entry = appendPendingThreadMessages([], [], [queued])[0]!;
      expect(isCompactionCommandFeedEntry(entry)).toBe(false);
      expect(entry.pendingMessage).toEqual(queued);
      if (!withAttachment) {
        expect(isCompactionCommandFeedEntry({ ...entry, pendingMessage: undefined })).toBe(true);
      }
    },
  );

  it("marks the synthetic creation prompt pending without duplicating it", () => {
    const queued = {
      ...pending("creation"),
      creation: {
        projectId: ProjectId.make("project"),
        workspaceMode: "local" as const,
        branch: "main",
        worktreePath: null,
      },
    };
    const prompt = appendPendingThreadMessages([], [], [queued])[0]!;
    const synthetic = { ...prompt, pendingMessage: undefined };
    const result = appendPendingThreadMessages([synthetic], [synthetic], [queued]);
    expect(result).toHaveLength(1);
    expect(result[0]?.pendingMessage).toEqual(queued);
    expect(result[0]?.acknowledged).toBe(false);
  });

  it("retains context records while a message is waiting for delivery", () => {
    const record = {
      version: 1 as const,
      kind: "mention" as const,
      contextId: ComposerContextId.make("setup-file"),
      label: "Checkout.tsx",
      path: "src/Checkout.tsx",
    };
    const context = { version: 1 as const, records: [record] };
    const text = "[Checkout.tsx](supaterm-context://v1/mention/setup-file)";
    const entries = appendPendingThreadMessages([], [], [{ ...pending("context"), text, context }]);
    const entry = entries[0];
    expect(entry?.type).toBe("message");
    if (entry?.type !== "message") throw new Error("Expected a pending message");
    expect(entry.message.text).toBe(text);
    expect(entry.message.context).toEqual(context);
  });

  it("retains local preview sources through presentation until creation is delivered", () => {
    const attachment = {
      id: "local-image",
      type: "image" as const,
      name: "photo.png",
      mimeType: "image/png",
      sizeBytes: 42,
      previewUri: "file:///draft/photo.png",
      fileUri: "file:///draft/photo.png",
    };
    const queued = { ...pending("creation"), attachments: [attachment] };
    const optimistic = appendPendingThreadMessages([], [], [queued])[0]!;
    const anchored = { ...optimistic, pendingMessage: undefined, draftAttachments: undefined };
    const feed = retainPendingCreationAttachments([anchored], queued);
    const presented = appendPendingThreadMessages(
      deriveThreadFeedPresentation(feed, null, new Set()),
      feed,
      [],
    );
    expect(presented[0]?.draftAttachments).toEqual([attachment]);
    expect(presented[0]?.pendingMessage).toBeUndefined();
    expect(retainPendingCreationAttachments([anchored], null)[0]?.draftAttachments).toBeUndefined();
    expect(anchored.draftAttachments).toBeUndefined();
  });

  it("keeps a queued creation editable until delivery, without duplicating the prompt", () => {
    const queued = pending("creation");
    const optimistic = appendPendingThreadMessages([], [], [queued])[0]!;
    const anchored = { ...optimistic, pendingMessage: undefined };
    const feed = retainPendingCreationAttachments([anchored], queued, true);
    const presented = appendPendingThreadMessages(feed, feed, [queued]);
    expect(presented).toHaveLength(1);
    expect(presented[0]?.pendingMessage).toBe(queued);
    expect(
      retainPendingCreationAttachments([anchored], queued, false)[0]?.pendingMessage,
    ).toBeUndefined();
  });

  it("keeps local preview sources on queued messages", () => {
    const attachment = {
      id: "local-pdf",
      type: "file" as const,
      name: "file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///draft/file.pdf",
    };
    const queued = { ...pending("queued"), attachments: [attachment] };
    expect(appendPendingThreadMessages([], [], [queued])[0]?.pendingMessage?.attachments).toEqual([
      attachment,
    ]);
  });

  it("keeps pending messages after newer agent activity in queue order", () => {
    const activity = {
      type: "thinking",
      runId: null,
      id: "thinking",
      createdAt: "2026-09-06T11:00:00.000Z",
    } as const;
    const entries = appendPendingThreadMessages(
      [activity],
      [],
      [pending("first"), pending("second")],
    );
    expect(entries.map((entry) => entry.id)).toEqual(["thinking", "first", "second"]);
    expect(entries[1]?.pendingMessage?.text).toBe("first");
  });

  it("reuses the message id and suppresses the pending copy when delivery appears", () => {
    const queued = pending("sent");
    const optimistic = appendPendingThreadMessages([], [], [queued])[0]!;
    const delivered = { ...optimistic, pendingMessage: undefined };
    expect(appendPendingThreadMessages([delivered], [delivered], [queued])).toEqual([delivered]);
    expect(appendPendingThreadMessages([], [delivered], [queued])).toEqual([]);
  });

  it("stops showing an acknowledged message once the projection holds it, even when the feed hides it", () => {
    // A rolled-back or cancelled queued run keeps its message in projection.messages
    // while its user_message item leaves the visible feed.
    const echoed = pending("rolled-back");
    const waiting = pending("waiting");
    const shown = selectPendingAcknowledgedMessages([echoed, waiting], {
      threadKey: "env:thread",
      queuedMessages: [],
      projectedMessages: [{ id: echoed.messageId }],
    });
    expect(shown).toEqual([waiting]);
    expect(appendPendingThreadMessages([], [], shown).map((entry) => entry.id)).toEqual([
      "waiting",
    ]);
  });
});
