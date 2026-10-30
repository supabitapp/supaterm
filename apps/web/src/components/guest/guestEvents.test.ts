import { expect, it } from "vite-plus/test";
import { openGuestEvents } from "./guestEvents";
import type { GuestTransport } from "./guestTransport";

it("decodes split UTF-8 frames and cancels the encrypted stream on close", async () => {
  const received: string[] = [];
  const complete = Promise.withResolvers<void>();
  const canceled = Promise.withResolvers<void>();
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
  const complete = Promise.withResolvers<void>();
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
