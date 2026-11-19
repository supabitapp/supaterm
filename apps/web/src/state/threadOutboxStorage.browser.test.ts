import { CommandId, EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import { expect, it } from "vite-plus/test";

import { randomUUID } from "../lib/utils";

import { createBrowserThreadOutboxStorage } from "./threadOutboxStorage";

it("preserves queued messages and delivery leases after a silent database close", async () => {
  const closing = { next: false };
  const storage = createBrowserThreadOutboxStorage({
    begin: (database, stores, mode) => {
      if (closing.next) {
        closing.next = false;
        database.close();
      }
      return database.transaction(stores, mode);
    },
  });
  const id = randomUUID();
  const entry = {
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
  await storage.writeMany([entry]);

  closing.next = true;
  try {
    expect(await storage.load()).toContainEqual(entry);
    expect(await storage.write({ ...entry, paused: true })).toBe(true);
    expect(await storage.load()).toContainEqual({ ...entry, paused: true });
    let deliveries = 0;
    const delivered = async () => {
      deliveries += 1;
      return "delivered";
    };
    expect(await storage.withLock(entry.scope, delivered)).toBe("delivered");
    expect(deliveries).toBe(1);
    await storage.remove(id);
    expect((await storage.load()).some((value) => value.id === id)).toBe(false);
  } finally {
    closing.next = false;
    await storage.remove(id).catch(() => {});
  }
});
