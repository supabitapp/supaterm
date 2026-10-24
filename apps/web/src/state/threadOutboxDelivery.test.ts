import { shouldRetryThreadOutboxDelivery } from "@supaterm/client-runtime/thread-outbox";
import { AtomRegistry } from "effect/reactivity";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "@effect/vitest";

import {
  createBrowserThreadOutbox,
  type ThreadOutboxEntry,
  type BrowserThreadOutboxStorage,
} from "./threadOutboxDelivery";

function deferred<A = void>() {
  let resolve: (value: A) => void = () => {};
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

type Payload = {
  commandId: string;
  text: string;
  bytes: string;
  threadId: string;
  voice?: string;
};

class PreparationFailure extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

function transcribed({ voice, ...payload }: Payload): Payload {
  return { ...payload, text: `${payload.text} ${voice}` };
}

function harness() {
  const records = new Map<string, ThreadOutboxEntry<Payload>>();
  const locks = new Set<string>();
  let now = 0;
  let online = false;
  const delivered: ThreadOutboxEntry<Payload>[] = [];
  const storage: BrowserThreadOutboxStorage<Payload> = {
    load: vi.fn(async () => [...records.values()]),
    write: vi.fn(async (entry) => {
      if (!records.has(entry.id)) return false;
      records.set(entry.id, entry);
      return true;
    }),
    writeMany: vi.fn(async (entries) => {
      for (const entry of entries) records.set(entry.id, entry);
    }),
    remove: vi.fn(async (id) => {
      records.delete(id);
    }),
    withLock: async (scope, action) => {
      if (locks.has(scope)) return null;
      locks.add(scope);
      try {
        return await action();
      } finally {
        locks.delete(scope);
      }
    },
  };
  const deliver = vi.fn(async (entry: ThreadOutboxEntry<Payload>) => {
    delivered.push(entry);
  });
  const prepare = vi.fn(async (entry: ThreadOutboxEntry<Payload>, _signal: AbortSignal) =>
    transcribed(entry.payload),
  );
  const create = () =>
    createBrowserThreadOutbox({
      registry: AtomRegistry.make(),
      identify: (payload) => ({
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make(payload.threadId),
      }),
      storage,
      now: () => now,
      canDeliver: () => online,
      deliver,
      needsPreparation: (payload) => payload.voice !== undefined,
      prepare,
      shouldRetryPreparation: (error) => error instanceof PreparationFailure && error.transient,
    });
  return {
    records,
    storage,
    deliver,
    prepare,
    delivered,
    create,
    connect: () => {
      online = true;
    },
    advance: (time: number) => {
      now = time;
    },
  };
}

function message(id: string, scope = "environment:thread", createdAt = "2026-10-06T00:00:00Z") {
  return {
    id,
    scope,
    createdAt,
    payload: { commandId: `command:${id}`, text: id, bytes: `attachment:${id}`, threadId: scope },
  };
}

function voiceMessage(id: string) {
  const queued = message(id);
  return { ...queued, payload: { ...queued.payload, voice: "transcript" } };
}

describe("durable thread outbox", () => {
  it("keeps an unchanged offline snapshot stable when IndexedDB returns cloned records", async () => {
    const h = harness();
    const outbox = h.create();
    await outbox.enqueue(message("prompt"));
    vi.mocked(h.storage.load).mockImplementation(async () =>
      structuredClone([...h.records.values()]),
    );
    const snapshot = outbox.getSnapshot();
    const changed = vi.fn();
    const unsubscribe = outbox.subscribe(changed);
    await outbox.drain();
    await outbox.reload();
    expect(outbox.getSnapshot()).toBe(snapshot);
    expect(changed).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("retains pending messages and reports a failed environment cleanup", async () => {
    const h = harness();
    const outbox = h.create();
    await outbox.enqueue(message("prompt"));
    vi.mocked(h.storage.remove).mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(outbox.clearEnvironment(EnvironmentId.make("environment"))).rejects.toThrow(
      "Some pending messages could not be removed.",
    );
    expect(outbox.getSnapshot().map((entry) => entry.id)).toEqual(["prompt"]);
    expect(h.records.has("prompt")).toBe(true);
  });

  it("accepts a send only after its durable transaction commits", async () => {
    const h = harness();
    const outbox = h.create();
    const writing = deferred();
    const commit = deferred();
    vi.mocked(h.storage.writeMany).mockImplementationOnce(async (entries) => {
      writing.resolve();
      await commit.promise;
      for (const entry of entries) h.records.set(entry.id, entry);
    });
    const accepted = outbox.enqueue(message("first"));
    await writing.promise;
    h.connect();
    await outbox.drain();
    expect(outbox.getSnapshot()).toEqual([]);
    expect(h.delivered).toEqual([]);
    commit.resolve();
    await accepted;
    await outbox.drain();
    expect(h.delivered.map((entry) => entry.id)).toEqual(["first"]);
  });

  it("recovers offline messages and sends each thread in submission order", async () => {
    const h = harness();
    const original = h.create();
    await original.enqueueMany([
      message("second", "a", "2026-10-06T00:01:00Z"),
      message("first", "a"),
      message("other", "b"),
    ]);
    const recovered = h.create();
    await recovered.load();
    await recovered.drain();
    expect(h.delivered).toEqual([]);
    h.connect();
    await recovered.drain();
    await recovered.drain();
    expect(h.delivered.filter((entry) => entry.scope === "a").map((entry) => entry.id)).toEqual([
      "first",
      "second",
    ]);
    expect(h.delivered.some((entry) => entry.id === "other")).toBe(true);
    expect(h.records.size).toBe(0);
  });

  it("keeps the same payload and IDs after an acknowledgement is lost and the app restarts", async () => {
    const h = harness();
    const first = h.create();
    h.connect();
    await first.enqueue(message("prompt"));
    h.deliver.mockImplementationOnce(async (entry) => {
      h.delivered.push(entry);
      throw { _tag: "RpcClientError" };
    });
    expect(await first.drain()).toBe(1_000);
    expect(await first.cancel("prompt")).toBe(false);
    expect(
      await first.edit("prompt", {
        commandId: "changed",
        text: "changed",
        bytes: "changed",
        threadId: "thread",
      }),
    ).toBe(false);
    const recovered = h.create();
    await recovered.load();
    await recovered.drain();
    expect(h.delivered).toHaveLength(1);
    h.advance(1_000);
    await recovered.drain();
    expect(h.delivered.map((entry) => entry.payload)).toEqual([
      message("prompt").payload,
      message("prompt").payload,
    ]);
    expect(h.records.size).toBe(0);
  });

  it("does not replay an acknowledged message when deleting its local record fails", async () => {
    const h = harness();
    const outbox = h.create();
    h.connect();
    await outbox.enqueue(message("prompt"));
    vi.mocked(h.storage.remove).mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(outbox.drain()).rejects.toThrow("disk unavailable");
    expect(h.records.get("prompt")?.status).toBe("delivered");
    const recovered = h.create();
    await recovered.drain();
    expect(h.delivered).toHaveLength(1);
    expect(h.records.size).toBe(0);
  });

  it("keeps a message sending until its acknowledgement is recorded", async () => {
    const h = harness();
    const outbox = h.create();
    h.connect();
    await outbox.enqueue(message("prompt"));
    const write = vi.mocked(h.storage.write).getMockImplementation()!;
    let sendingWhenAcknowledged: boolean | null = null;
    vi.mocked(h.storage.write).mockImplementation(async (entry) => {
      if (entry.status === "delivered") sendingWhenAcknowledged = outbox.isSending(entry.id);
      return write(entry);
    });
    await outbox.drain();
    expect(sendingWhenAcknowledged).toBe(true);
    expect(outbox.isSending("prompt")).toBe(false);
  });

  it("pauses delivery during editing and sends the saved text with its attachments", async () => {
    const h = harness();
    const outbox = h.create();
    await outbox.enqueue(message("prompt"));
    await outbox.pause("prompt", true);
    h.connect();
    await outbox.drain();
    expect(h.delivered).toEqual([]);
    await outbox.edit("prompt", { ...message("prompt").payload, text: "edited" });
    await outbox.drain();
    expect(h.delivered[0]?.payload).toEqual({
      commandId: "command:prompt",
      text: "edited",
      bytes: "attachment:prompt",
      threadId: "environment:thread",
    });
  });

  it("cancels before delivery without resurrecting the message after restart", async () => {
    const h = harness();
    const outbox = h.create();
    await outbox.enqueue(message("prompt"));
    expect(await outbox.cancel("prompt")).toBe(true);
    h.connect();
    await h.create().drain();
    expect(h.delivered).toEqual([]);
    expect(h.records.size).toBe(0);
  });

  it("serializes tabs so another tab cannot deliver or edit an in-flight send", async () => {
    const h = harness();
    const first = h.create();
    const second = h.create();
    const started = deferred();
    const finish = deferred();
    h.deliver.mockImplementationOnce(async (entry) => {
      h.delivered.push(entry);
      started.resolve();
      await finish.promise;
    });
    await first.enqueue(message("prompt"));
    await second.load();
    h.connect();
    const drain = first.drain();
    await started.promise;
    await second.drain();
    expect(await second.cancel("prompt")).toBe(false);
    finish.resolve();
    await drain;
    await second.reload();
    await second.drain();
    expect(h.delivered).toHaveLength(1);
  });

  it("retains rejected messages and blocks later messages until the user fixes or cancels them", async () => {
    const h = harness();
    const outbox = h.create();
    h.connect();
    await outbox.enqueueMany([
      message("first"),
      message("second", "environment:thread", "2026-10-06T00:01:00Z"),
    ]);
    h.deliver.mockRejectedValueOnce({
      _tag: "OrchestrationDispatchCommandError",
      message: "Invalid model",
    });
    expect(await outbox.drain()).toBeNull();
    expect(await outbox.drain()).toBeNull();
    expect(outbox.getSnapshot()[0]?.status).toBe("failed");
    expect(h.delivered).toEqual([]);
    await outbox.edit("first", { ...message("first").payload, commandId: "fixed-command" });
    await outbox.drain();
    await outbox.drain();
    expect(h.delivered.map((entry) => entry.payload.commandId)).toEqual([
      "fixed-command",
      "command:second",
    ]);
  });

  it("keeps all drafts unaccepted when an atomic multiple-model submission fails", async () => {
    const h = harness();
    const outbox = h.create();
    vi.mocked(h.storage.writeMany).mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(outbox.enqueueMany([message("a", "a"), message("b", "b")])).rejects.toThrow(
      "quota exceeded",
    );
    h.connect();
    await outbox.drain();
    expect(h.delivered).toEqual([]);
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it("shares retry classification with mobile", () => {
    expect(shouldRetryThreadOutboxDelivery({ _tag: "RpcClientError" })).toBe(true);
    expect(shouldRetryThreadOutboxDelivery({ _tag: "EnvironmentAuthorizationError" })).toBe(false);
    expect(shouldRetryThreadOutboxDelivery({ message: "Environment is not connected." })).toBe(
      true,
    );
  });

  it("recovers a crashed editor after its pause lease expires", async () => {
    const h = harness();
    const outbox = h.create();
    await outbox.enqueue(message("prompt"));
    await outbox.pause("prompt", true);
    h.connect();
    const recovered = h.create();
    expect(await recovered.drain()).toBe(60_000);
    expect(h.delivered).toEqual([]);
    h.advance(60_000);
    await recovered.drain();
    expect(h.delivered.map((entry) => entry.id)).toEqual(["prompt"]);
  });

  it("keeps submission order after restart when timestamps are identical", async () => {
    const h = harness();
    const outbox = h.create();
    await outbox.enqueueMany([message("z-first"), message("a-second")]);
    // IndexedDB reads records in primary-key order, not insertion order.
    vi.mocked(h.storage.load).mockImplementation(async () =>
      [...h.records.values()].sort((a, b) => a.id.localeCompare(b.id)),
    );
    h.connect();
    const recovered = h.create();
    await recovered.drain();
    await recovered.drain();
    expect(h.delivered.map((entry) => entry.id)).toEqual(["z-first", "a-second"]);
  });

  it("does not resurrect messages cleared by another client during delivery", async () => {
    const h = harness();
    const outbox = h.create();
    h.connect();
    const started = deferred();
    const finish = deferred();
    h.deliver.mockImplementationOnce(async (entry) => {
      h.delivered.push(entry);
      started.resolve();
      await finish.promise;
    });
    await outbox.enqueue(message("prompt"));
    const drain = outbox.drain();
    await started.promise;
    h.records.delete("prompt");
    finish.resolve();
    await drain;
    expect(h.records.size).toBe(0);
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it("lets users edit and cancel later messages while the first send awaits acknowledgement", async () => {
    const h = harness();
    const sender = h.create();
    const editor = h.create();
    h.connect();
    const started = deferred();
    const finish = deferred();
    h.deliver.mockImplementationOnce(async (entry) => {
      h.delivered.push(entry);
      started.resolve();
      await finish.promise;
    });
    await sender.enqueueMany([
      message("first"),
      message("cancel", "environment:thread", "2026-10-06T00:01:00Z"),
      message("edit", "environment:thread", "2026-10-06T00:02:00Z"),
    ]);
    await editor.load();
    const drain = sender.drain();
    await started.promise;
    expect(await editor.cancel("cancel")).toBe(true);
    expect(
      await editor.edit("edit", { ...message("edit").payload, text: "edited while sending" }),
    ).toBe(true);
    expect(await editor.cancel("first")).toBe(false);
    finish.resolve();
    await drain;
    await sender.drain();
    expect(h.delivered.map((entry) => entry.id)).toEqual(["first", "edit"]);
    expect(h.delivered[1]?.payload.text).toBe("edited while sending");
  });

  it("saves the transcribed message before delivery sees it", async () => {
    const h = harness();
    const outbox = h.create();
    h.connect();
    await outbox.enqueue(voiceMessage("prompt"));
    const expected = transcribed(voiceMessage("prompt").payload);
    h.deliver.mockImplementationOnce(async (entry) => {
      expect(h.records.get("prompt")?.payload).toEqual(expected);
      h.delivered.push(entry);
    });
    await outbox.drain();
    expect(vi.mocked(h.storage.write).mock.calls[0]?.[0]).toMatchObject({
      payload: expected,
      attempted: false,
      error: null,
    });
    expect(h.delivered.map((entry) => entry.payload)).toEqual([expected]);
    expect(h.records.size).toBe(0);
  });

  it("retries a transient transcription failure without marking the message attempted", async () => {
    const h = harness();
    const first = h.create();
    h.connect();
    await first.enqueue(voiceMessage("prompt"));
    h.prepare.mockRejectedValueOnce(new PreparationFailure("Transcribes once connected.", true));
    expect(await first.drain()).toBe(1_000);
    expect(h.records.get("prompt")).toMatchObject({
      status: "pending",
      attempted: false,
      attempts: 1,
      retryAt: 1_000,
      error: "Transcribes once connected.",
    });
    expect(await first.drain()).toBe(1_000);
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(h.deliver).not.toHaveBeenCalled();

    h.advance(1_000);
    h.deliver.mockImplementationOnce(async (entry) => {
      h.delivered.push(entry);
      throw { _tag: "RpcClientError" };
    });
    await first.drain();
    expect(h.records.get("prompt")).toMatchObject({ attempted: true, status: "pending" });

    const recovered = h.create();
    h.advance(10_000);
    await recovered.drain();
    await recovered.drain();
    expect(h.prepare).toHaveBeenCalledTimes(2);
    const expected = transcribed(voiceMessage("prompt").payload);
    expect(h.delivered.map((entry) => entry.payload)).toEqual([expected, expected]);
    expect(h.records.size).toBe(0);
  });

  it("cancels an in-flight transcription and discards its late result", async () => {
    const h = harness();
    const outbox = h.create();
    h.connect();
    await outbox.enqueue(voiceMessage("prompt"));
    const started = deferred<AbortSignal>();
    const finish = deferred();
    h.prepare.mockImplementationOnce(async (entry, signal) => {
      started.resolve(signal);
      await finish.promise;
      return transcribed(entry.payload);
    });
    const drain = outbox.drain();
    const signal = await started.promise;
    expect(outbox.isPreparing("prompt")).toBe(true);
    expect(await outbox.cancel("prompt")).toBe(true);
    expect(signal.aborted).toBe(true);
    finish.resolve();
    await drain;
    await outbox.drain();
    expect(outbox.isPreparing("prompt")).toBe(false);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.records.size).toBe(0);
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it("marks a message failed when its recording cannot be transcribed", async () => {
    const h = harness();
    const outbox = h.create();
    h.connect();
    await outbox.enqueue(voiceMessage("prompt"));
    h.prepare.mockRejectedValueOnce(
      new PreparationFailure("No speech was detected. Nothing was sent.", false),
    );
    expect(await outbox.drain()).toBeNull();
    expect(await outbox.drain()).toBeNull();
    expect(h.records.get("prompt")).toMatchObject({
      status: "failed",
      attempted: false,
      error: "No speech was detected. Nothing was sent.",
    });
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it.each(["this tab", "another tab"] as const)(
    "drops a transcript prepared for a message edited in %s",
    async (editor) => {
      const h = harness();
      const outbox = h.create();
      const other = h.create();
      h.connect();
      await outbox.enqueue(voiceMessage("prompt"));
      await other.load();
      const started = deferred<AbortSignal>();
      const finish = deferred();
      h.prepare.mockImplementationOnce(async (entry, signal) => {
        started.resolve(signal);
        await finish.promise;
        return transcribed(entry.payload);
      });
      const drain = outbox.drain();
      const signal = await started.promise;
      const edited = { ...voiceMessage("prompt").payload, text: "edited" };
      expect(await (editor === "this tab" ? outbox : other).edit("prompt", edited)).toBe(true);
      expect(signal.aborted).toBe(editor === "this tab");
      finish.resolve();
      await drain;
      expect(h.deliver).not.toHaveBeenCalled();
      expect(h.records.get("prompt")?.payload).toEqual(edited);
      await outbox.drain();
      expect(h.delivered.map((entry) => entry.payload.text)).toEqual(["edited transcript"]);
    },
  );
});
