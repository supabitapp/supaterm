import { CommandId, EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

import { randomUUID } from "../lib/utils";

import { browserThreadOutboxStorage as storage } from "./threadOutboxStorage";

it("recovers queued messages and delivery leases when the database silently closes", async () => {
  const id = randomUUID();
  const entry = {
    id,
    scope: `environment:${id}`,
    createdAt: new Date().toISOString(),
    position: 1,
    payload: {
      environmentId: EnvironmentId.make("environment"),
      input: {
        commandId: CommandId.make(id),
        threadId: ThreadId.make(id),
        message: {
          messageId: MessageId.make(id),
          role: "user" as const,
          text: "Keep this queued message",
          attachments: [],
        },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
      },
      localAttachments: [],
    },
    status: "pending" as const,
    attempted: false,
    attempts: 0,
    retryAt: 0,
    error: null,
    paused: false,
    pauseUntil: 0,
  };
  await storage.writeMany([entry]);

  const original = IDBDatabase.prototype.transaction;
  const closing = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementationOnce(function (
    this: IDBDatabase,
    stores,
    mode,
    options,
  ) {
    this.close();
    return original.call(this, stores, mode, options);
  });
  try {
    expect(await storage.load()).toContainEqual(entry);
    expect(await storage.write({ ...entry, paused: true })).toBe(true);
    expect(await storage.load()).toContainEqual({ ...entry, paused: true });
    const delivered = vi.fn(async () => "delivered");
    expect(await storage.withLock(entry.scope, delivered)).toBe("delivered");
    expect(delivered).toHaveBeenCalledOnce();
    await storage.remove(id);
    expect((await storage.load()).some((value) => value.id === id)).toBe(false);
  } finally {
    closing.mockRestore();
    await storage.remove(id).catch(() => {});
  }
});
