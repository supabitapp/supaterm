import { CommandId, EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

import { randomUUID } from "../lib/utils";

import { browserThreadOutboxStorage as storage } from "./threadOutboxStorage";

function queuedEntry(id: string) {
  return {
    id,
    scope: `environment:${id}`,
    createdAt: "2026-10-06T00:00:00.000Z",
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
}

it("preserves queued messages and delivery leases after a silent database close", async () => {
  const id = randomUUID();
  const entry = queuedEntry(id);
  await storage.writeMany([entry]);

  const original = IDBDatabase.prototype.transaction;
  using closing = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementationOnce(function (
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

it("loads readable messages and skips a row it cannot read", async () => {
  const entry = queuedEntry(randomUUID());
  const unreadable = { id: randomUUID(), schemaVersion: 3 };
  await storage.writeMany([entry]);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("supaterm-thread-outbox");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("messages", "readwrite");
      transaction.objectStore("messages").put(unreadable);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
  try {
    using warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loaded = await storage.load();
    expect(loaded).toContainEqual(entry);
    expect(loaded.some((value) => value.id === unreadable.id)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  } finally {
    await storage.remove(entry.id);
    await storage.remove(unreadable.id);
  }
});
