import { assert, it } from "@effect/vitest";
import * as NodeEvents from "node:events";
import { vi } from "vite-plus/test";

import { startWindowsForegroundFocusThread } from "./WindowsForegroundFocusThread.ts";

const makeWorker = () =>
  Object.assign(new NodeEvents.EventEmitter(), {
    postMessage: vi.fn(),
    terminate: async () => 0,
    unref: () => undefined,
  });

const target = {
  windowId: 7,
  processId: 42,
  title: "Supaterm (Dev)",
  bounds: { x: 100, y: 50, width: 1_200, height: 800 },
  contentBounds: { x: 108, y: 50, width: 1_184, height: 792 },
};

function workerFactory(...workers: ReadonlyArray<ReturnType<typeof makeWorker>>) {
  const queue = [...workers];
  const paths: Array<string> = [];
  const create = (path: string) => {
    paths.push(path);
    const next = queue.shift();
    if (!next) throw new Error("No worker queued");
    return next;
  };
  return { create, paths };
}

it("queues focus until the helper is ready", async () => {
  const worker = makeWorker();
  const factory = workerFactory(worker);
  const thread = startWindowsForegroundFocusThread("focus.cjs", factory.create);
  const focused = thread.focus(target);

  assert.lengthOf(worker.postMessage.mock.calls, 0);
  worker.emit("message", "ready");
  assert.deepEqual(worker.postMessage.mock.calls[0]?.[0], {
    type: "focus",
    requestId: 1,
    target,
  });
  worker.emit("message", { type: "result", requestId: 1, focused: true });

  assert.isTrue(await focused);
  assert.deepEqual(factory.paths, ["focus.cjs"]);
  thread.close();
});

it("fails pending focus when the helper exits", async () => {
  const worker = makeWorker();
  const replacement = makeWorker();
  const factory = workerFactory(worker, replacement);
  const thread = startWindowsForegroundFocusThread("focus.cjs", factory.create);
  const focused = thread.focus(target);

  worker.emit("exit", 1);

  assert.isFalse(await focused);
  assert.lengthOf(factory.paths, 1);
  const prepared = thread.prepare(target);
  replacement.emit("message", "ready");
  replacement.emit("message", { type: "result", requestId: 2, focused: true });
  assert.isTrue(await prepared);
  assert.lengthOf(factory.paths, 2);
  thread.close();
});
