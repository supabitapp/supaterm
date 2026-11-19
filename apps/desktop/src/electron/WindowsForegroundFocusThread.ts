// @effect-diagnostics globalTimers:off -- The helper timeout runs at a worker callback boundary outside any Effect fiber.
// @effect-diagnostics nodeBuiltinImport:off -- This desktop-only helper owns a Node worker.

import * as NodeWorkerThreads from "node:worker_threads";

import type * as Electron from "electron";

const FOCUS_TIMEOUT_MS = 1_000;

export type WindowsForegroundFocusTarget = {
  readonly windowId: number;
  readonly processId: number;
  readonly title: string;
  readonly bounds: Electron.Rectangle;
  readonly contentBounds: Electron.Rectangle;
};

export type WindowsForegroundFocusThread = {
  readonly prepare: (target: WindowsForegroundFocusTarget) => Promise<boolean>;
  readonly focus: (target: WindowsForegroundFocusTarget) => Promise<boolean>;
  readonly close: () => void;
};

type FocusRequest = {
  readonly type: "prepare" | "focus";
  readonly requestId: number;
  readonly target: WindowsForegroundFocusTarget;
};

type FocusResult = {
  readonly type: "result";
  readonly requestId: number;
  readonly focused: boolean;
};

const unavailableThread = () => ({
  prepare: async () => false,
  focus: async () => false,
  close: () => undefined,
});

export type WindowsForegroundFocusWorker = {
  readonly postMessage: (message: FocusRequest) => void;
  readonly terminate: () => Promise<number>;
  readonly unref: () => void;
  readonly on: (event: "message", listener: (message: unknown) => void) => unknown;
  readonly once: (event: "error" | "exit", listener: () => void) => unknown;
};

const createNodeWorker: (workerPath: string) => WindowsForegroundFocusWorker = (workerPath) =>
  new NodeWorkerThreads.Worker(workerPath);

export function startWindowsForegroundFocusThread(
  workerPath: string,
  createWorker?: (workerPath: string) => WindowsForegroundFocusWorker,
): WindowsForegroundFocusThread;
export function startWindowsForegroundFocusThread(
  workerPath: string,
  createWorker = createNodeWorker,
) {
  let worker: WindowsForegroundFocusWorker | undefined;
  let ready = false;
  let closed = false;
  let nextRequestId = 1;
  const pending = new Map<
    number,
    {
      readonly request: FocusRequest;
      readonly resolve: (focused: boolean) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();

  const finish = (requestId: number, focused: boolean) => {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    clearTimeout(request.timeout);
    request.resolve(focused);
  };
  const send = (request: FocusRequest, targetWorker: WindowsForegroundFocusWorker) => {
    if (!ready || closed || worker !== targetWorker) return;
    try {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node workers do not accept a target origin.
      targetWorker.postMessage(request);
    } catch {
      finish(request.requestId, false);
    }
  };
  const start = () => {
    if (closed) return false;
    let nextWorker: WindowsForegroundFocusWorker;
    try {
      nextWorker = createWorker(workerPath);
      nextWorker.unref();
    } catch {
      return false;
    }

    worker = nextWorker;
    ready = false;
    const reset = () => {
      if (worker !== nextWorker) return;
      worker = undefined;
      ready = false;
      for (const requestId of pending.keys()) finish(requestId, false);
    };
    nextWorker.on("message", (rawMessage) => {
      if (worker !== nextWorker) return;
      if (rawMessage === "ready") {
        ready = true;
        for (const request of pending.values()) send(request.request, nextWorker);
        return;
      }
      const message = rawMessage as FocusResult;
      if (message.type === "result") finish(message.requestId, message.focused);
    });
    nextWorker.once("error", reset);
    nextWorker.once("exit", reset);
    return true;
  };

  if (!start()) return unavailableThread() satisfies WindowsForegroundFocusThread;

  const restart = (timedOutWorker: WindowsForegroundFocusWorker | undefined) => {
    if (!timedOutWorker || worker !== timedOutWorker) return;
    worker = undefined;
    ready = false;
    for (const requestId of pending.keys()) finish(requestId, false);
    void timedOutWorker.terminate();
    start();
  };
  const request = (type: FocusRequest["type"], target: WindowsForegroundFocusTarget) =>
    new Promise<boolean>((resolve) => {
      if (closed || (!worker && !start())) {
        resolve(false);
        return;
      }
      const requestId = nextRequestId++;
      const focusRequest = { type, requestId, target } satisfies FocusRequest;
      const requestWorker = worker!;
      const timeout = setTimeout(() => {
        finish(requestId, false);
        restart(requestWorker);
      }, FOCUS_TIMEOUT_MS);
      timeout.unref();
      pending.set(requestId, { request: focusRequest, resolve, timeout });
      send(focusRequest, requestWorker);
    });

  return {
    prepare: (target) => request("prepare", target),
    focus: (target) => request("focus", target),
    close: () => {
      if (closed) return;
      closed = true;
      const activeWorker = worker;
      worker = undefined;
      ready = false;
      for (const requestId of pending.keys()) finish(requestId, false);
      if (activeWorker) void activeWorker.terminate();
    },
  } satisfies WindowsForegroundFocusThread;
}
