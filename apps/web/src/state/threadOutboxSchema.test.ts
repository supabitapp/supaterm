import { CommandId, EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { OutboxTurn, StoredOutboxEntry, encodeStoredOutboxEntry } from "./threadOutboxSchema";

const decodeStored = Schema.decodeSync(StoredOutboxEntry);
const { pendingWorktree: _, ...legacyPayloadFields } = OutboxTurn.fields;
const decodeLegacy = Schema.decodeUnknownSync(
  Schema.Struct({
    ...StoredOutboxEntry.fields,
    schemaVersion: Schema.Literal(1),
    payload: Schema.Struct(legacyPayloadFields),
  }),
);

function queuedWorktree() {
  return {
    id: "message",
    scope: "environment:thread",
    createdAt: "2026-10-09T00:00:00Z",
    position: 1,
    payload: {
      environmentId: EnvironmentId.make("environment"),
      input: {
        commandId: CommandId.make("command"),
        threadId: ThreadId.make("thread"),
        message: {
          messageId: MessageId.make("message"),
          role: "user" as const,
          text: "Offline task",
          attachments: [],
        },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
      },
      pendingWorktree: { projectCwd: "/project", startFromOrigin: true },
      localAttachments: [
        {
          id: "local-file",
          type: "file" as const,
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
          bytes: new Blob(["notes"]),
        },
      ],
    },
    status: "pending" as const,
    attempted: false,
    attempts: 0,
    retryAt: 0,
    error: null,
    paused: false,
    pauseUntil: 0,
  };
}

describe("stored thread outbox compatibility", () => {
  it("retains unresolved worktree intent and attachment bytes in the new format", async () => {
    const saved = encodeStoredOutboxEntry(queuedWorktree());
    const restored = decodeStored(saved);
    expect(restored.schemaVersion).toBe(2);
    expect(restored.payload.pendingWorktree).toEqual({
      projectCwd: "/project",
      startFromOrigin: true,
    });
    expect(await restored.payload.localAttachments[0]?.bytes?.text()).toBe("notes");
  });

  it("prevents older tabs from reading a worktree request without its workspace intent", () => {
    const saved = encodeStoredOutboxEntry(queuedWorktree());
    expect(() => decodeLegacy(saved)).toThrow();
    expect(decodeLegacy({ ...saved, schemaVersion: 1 }).payload).not.toHaveProperty(
      "pendingWorktree",
    );
  });

  it("continues loading messages persisted by older clients", () => {
    const { pendingWorktree: _, ...legacyPayload } = queuedWorktree().payload;
    const restored = decodeStored({
      ...queuedWorktree(),
      schemaVersion: 1,
      payload: legacyPayload,
    });
    expect(restored.payload.input.message.text).toBe("Offline task");
    expect(restored.payload.pendingWorktree).toBeUndefined();
  });

  it.each([false, true])(
    "drops legacy automatic-compaction metadata without losing the queued message: accepted=%s",
    (compactAccepted) => {
      const saved = encodeStoredOutboxEntry(queuedWorktree());
      const legacyEntry = {
        ...saved,
        payload: { ...saved.payload, compactBeforeSend: true, compactAccepted },
      };
      const restored = decodeStored(legacyEntry);
      expect(restored.payload).toEqual(saved.payload);
    },
  );
});
