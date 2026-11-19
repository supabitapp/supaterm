import { assert, it } from "@effect/vitest";
import * as NodeEvents from "node:events";
import { vi } from "vite-plus/test";

import {
  makeSnapShotAccessibilityProcessPool,
  startSnapShotAccessibilityProcess,
} from "./SnapShotAccessibilityProcess.ts";

const makeWorker = () =>
  Object.assign(new NodeEvents.EventEmitter(), {
    kill: () => true,
    send: vi.fn(),
  });

function forkQueue(...workers: Array<ReturnType<typeof makeWorker>>) {
  const forked: Array<string> = [];
  const fork = (workerPath: string) => {
    forked.push(workerPath);
    const next = workers.shift();
    if (!next) throw new Error("No accessibility worker queued");
    return next;
  };
  return { fork, forked };
}
const request = {
  active: {
    title: "Zoom Meeting",
    bounds: { x: 10, y: 20, width: 800, height: 600 },
    owner: { processId: 42 },
  },
  platform: "darwin" as const,
  sourceTitle: "Zoom Meeting",
  imageSize: { width: 1_600, height: 1_200 },
};

it("keeps Supaterm alive when Zoom crashes accessibility extraction", async () => {
  const worker = makeWorker();
  const process = startSnapShotAccessibilityProcess("accessibility.cjs", forkQueue(worker).fork);
  const read = process.read(request);
  worker.emit("message", "ready");
  worker.emit("message", "started");
  await read.started;
  worker.emit("exit", null, "SIGABRT");

  assert.isUndefined(await read.result);
});

it("returns immediately when accessibility crashes before the screenshot is ready", async () => {
  const worker = makeWorker();
  const process = startSnapShotAccessibilityProcess("accessibility.cjs", forkQueue(worker).fork);
  worker.emit("exit", null, "SIGABRT");

  const read = process.read(request);
  await read.started;
  assert.isUndefined(await read.result);
});

it("replaces a warm helper that exits before capture", async () => {
  const exitedWorker = makeWorker();
  const captureWorker = makeWorker();
  const replacementWorker = makeWorker();
  const workers = forkQueue(exitedWorker, captureWorker, replacementWorker);
  const pool = makeSnapShotAccessibilityProcessPool("accessibility.cjs", workers.fork);

  pool.warm();
  exitedWorker.emit("exit", 1);
  const read = pool.read(request);
  captureWorker.emit("message", "ready");
  captureWorker.emit("message", "started");
  captureWorker.emit("message", { type: "result", context: { accessibleText: "Recovered" } });

  assert.deepEqual(await read.result, { accessibleText: "Recovered" });
  assert.lengthOf(workers.forked, 3);
  assert.deepEqual(captureWorker.send.mock.calls[0]?.[0], request);
  pool.close();
});
