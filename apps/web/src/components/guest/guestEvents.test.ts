import { GUEST_STREAM_MAX_EVENT_BYTES, GUEST_STREAM_ERROR_EVENT } from "@supaterm/contracts";
import { GuestStreamEvent } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { makeStreamingTimelineFixture, makeThreadProjectionFixture } from "../../test-fixtures";
import { expect, it, vi } from "vite-plus/test";
import { openGuestEvents } from "./guestEvents";
import type { GuestTransport } from "./guestTransport";

const encodeEvent = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(GuestStreamEvent)));

function completion() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("decodes split UTF-8 frames and cancels the encrypted stream on close", async () => {
  const received: string[] = [];
  const complete = completion();
  const canceled = completion();
  const bytes = new TextEncoder().encode(': ping\n\ndata: {"text":"café"}\n\ndata: done\n\n');
  const transport: GuestTransport = {
    setToken() {},
    close() {},
    async request() {
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          },
          cancel() {
            canceled.resolve();
          },
        }),
      );
    },
  };
  const stream = openGuestEvents(
    transport,
    "/api/guest/stream",
    (data) => {
      received.push(data);
      if (data === "done") {
        stream.close();
        complete.resolve();
      }
    },
    () => complete.reject(new Error("Unexpected rejection.")),
  );
  await complete.promise;
  await canceled.promise;
  expect(received).toEqual(['{"text":"café"}', "done"]);
});

it("reports rejected guest access without reconnecting", async () => {
  const complete = completion();
  let requests = 0;
  const transport: GuestTransport = {
    setToken() {},
    close() {},
    async request() {
      requests++;
      return new Response(null, { status: 403 });
    },
  };
  const stream = openGuestEvents(
    transport,
    "/api/guest/stream",
    () => complete.reject(new Error("Unexpected event.")),
    () => complete.resolve(),
  );
  await complete.promise;
  stream.close();
  expect(requests).toBe(1);
});

it("delivers a large snapshot and its terminal event without reconnecting", async () => {
  const fixture = makeStreamingTimelineFixture("x".repeat(550_000));
  const snapshot = encodeEvent({
    type: "thread",
    item: {
      kind: "snapshot",
      snapshotSequence: 1,
      projection: {
        ...makeThreadProjectionFixture(),
        turnItems: fixture.visibleTurnItems.map((row) => row.item),
        visibleTurnItems: fixture.visibleTurnItems,
      },
    },
  });
  expect(new TextEncoder().encode(snapshot).byteLength).toBeGreaterThan(1024 * 1024);
  const ended = JSON.stringify({ type: "ended" });
  const bytes = new TextEncoder().encode(`data: ${snapshot}\n\ndata: ${ended}\n\n`);
  const canceled = completion();
  const received: string[] = [];
  let requests = 0;
  let offset = 0;
  const transport: GuestTransport = {
    setToken() {},
    close() {},
    async request() {
      requests++;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (offset === bytes.length) {
              controller.close();
              return;
            }
            const end = Math.min(offset + 16 * 1024, bytes.length);
            controller.enqueue(bytes.slice(offset, end));
            offset = end;
          },
          cancel() {
            canceled.resolve();
          },
        }),
      );
    },
  };
  const stream = openGuestEvents(
    transport,
    "/api/guest/stream",
    (data) => {
      received.push(data);
      if (data === ended) {
        stream.close();
        canceled.resolve();
      }
    },
    () => {},
  );
  try {
    await canceled.promise;
    expect(received).toEqual([snapshot, ended]);
    expect(requests).toBe(1);
  } finally {
    stream.close();
  }
});

it.each([false, true])(
  "reports an oversized UTF-8 frame once without reconnecting (terminated: %s)",
  async (terminated) => {
    vi.useFakeTimers();
    const rejected = completion();
    const failures: Array<string | undefined> = [];
    const bytes = new TextEncoder().encode(
      `data: ${"é".repeat(GUEST_STREAM_MAX_EVENT_BYTES / 2)}${terminated ? "\n\n" : ""}`,
    );
    let requests = 0;
    let offset = 0;
    const transport: GuestTransport = {
      setToken() {},
      close() {},
      async request() {
        requests++;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (offset === bytes.length) {
                controller.close();
                return;
              }
              const end = Math.min(offset + 16 * 1024, bytes.length);
              controller.enqueue(bytes.slice(offset, end));
              offset = end;
            },
          }),
        );
      },
    };
    const stream = openGuestEvents(
      transport,
      "/api/guest/stream",
      () => rejected.reject(new Error("Oversized frame was delivered.")),
      (reason) => {
        failures.push(reason);
        rejected.resolve();
      },
    );
    try {
      await rejected.promise;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(failures).toEqual(["event_too_large"]);
      expect(requests).toBe(1);
    } finally {
      stream.close();
      vi.useRealTimers();
    }
  },
);

it("stops on the server's terminal budget error without delivering later events", async () => {
  const rejected = completion();
  const received: string[] = [];
  const failures: Array<string | undefined> = [];
  const bytes = new TextEncoder().encode(
    `data: before\n\nevent: ${GUEST_STREAM_ERROR_EVENT}\ndata: {"reason":"event_too_large"}\n\ndata: after\n\n`,
  );
  const transport: GuestTransport = {
    setToken() {},
    close() {},
    async request() {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
          },
        }),
      );
    },
  };
  const stream = openGuestEvents(
    transport,
    "/api/guest/stream",
    (data) => received.push(data),
    (reason) => {
      failures.push(reason);
      rejected.resolve();
    },
  );
  try {
    await rejected.promise;
    expect(received).toEqual(["before"]);
    expect(failures).toEqual(["event_too_large"]);
  } finally {
    stream.close();
  }
});

it("applies the frame limit to each event, including exact-limit frames", async () => {
  const first = "x".repeat(GUEST_STREAM_MAX_EVENT_BYTES - 8);
  const second = "next";
  const bytes = new TextEncoder().encode(`data: ${first}\n\ndata: ${second}\n\n`);
  const complete = completion();
  const received: string[] = [];
  const transport: GuestTransport = {
    setToken() {},
    close() {},
    async request() {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
          },
        }),
      );
    },
  };
  const stream = openGuestEvents(
    transport,
    "/api/guest/stream",
    (data) => {
      received.push(data);
      if (data === second) {
        stream.close();
        complete.resolve();
      }
    },
    () => complete.reject(new Error("Valid frame was refused.")),
  );
  try {
    await complete.promise;
    expect(received).toEqual([first, second]);
  } finally {
    stream.close();
  }
});
