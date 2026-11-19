import * as NodeModule from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const requireCjs = NodeModule.createRequire(import.meta.url);
const {
  WindowsPtyAgent,
}: {
  WindowsPtyAgent: {
    prototype: {
      _flushDataAndCleanUp(this: FakeAgent): void;
      _cleanUpProcess(this: FakeAgent): void;
    };
  };
} = requireCjs("node-pty/lib/windowsPtyAgent.js");

interface FakeAgent {
  _useConptyDll: boolean;
  _closeTimeout?: unknown;
  _inSocket: { readable: boolean };
  _outSocket: { readable: boolean; destroy: () => void };
  _cleanUpProcess: () => void;
}

const makeAgent = () => {
  const agent: FakeAgent = {
    _useConptyDll: false,
    _inSocket: { readable: true },
    _outSocket: { readable: true, destroy: vi.fn() },
    _cleanUpProcess: () => WindowsPtyAgent.prototype._cleanUpProcess.call(agent),
  };
  return agent;
};

const flush = (agent: FakeAgent) => WindowsPtyAgent.prototype._flushDataAndCleanUp.call(agent);

interface Timer {
  readonly id: number;
  readonly dueAt: number;
  readonly run: () => void;
}
let now = 0;
let nextId = 0;
let timers: Timer[] = [];
let immediates: Array<() => void> = [];

const runExpiredTimers = () => {
  for (const timer of timers.filter((t) => t.dueAt <= now).toSorted((a, b) => a.dueAt - b.dueAt)) {
    timers = timers.filter((t) => t.id !== timer.id);
    timer.run();
  }
};
const runImmediates = () => {
  const batch = immediates;
  immediates = [];
  for (const run of batch) run();
};
const loopIteration = (ms: number, poll?: () => void) => {
  now += ms;
  runExpiredTimers();
  poll?.();
  runImmediates();
};

describe("node-pty Windows exit flush", () => {
  beforeEach(() => {
    now = 0;
    nextId = 0;
    timers = [];
    immediates = [];
    vi.stubGlobal("setTimeout", (run: () => void, ms: number) => {
      const id = ++nextId;
      timers.push({ id, dueAt: now + ms, run });
      return id;
    });
    vi.stubGlobal("clearTimeout", (id: number) => {
      timers = timers.filter((t) => t.id !== id);
    });
    vi.stubGlobal("setImmediate", (run: () => void) => {
      immediates.push(run);
      return ++nextId;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes the output socket 100 ms after the exit, not a second later", () => {
    const agent = makeAgent();
    flush(agent);

    loopIteration(99);
    expect(agent._outSocket.destroy).not.toHaveBeenCalled();

    loopIteration(1);
    expect(agent._outSocket.destroy).toHaveBeenCalledTimes(1);
    expect(agent._outSocket.readable).toBe(false);
    expect(agent._inSocket.readable).toBe(false);
  });

  it("keeps the socket open when buffered output is read right after a stalled timer expires", () => {
    const agent = makeAgent();
    flush(agent);

    loopIteration(150, () => flush(agent));
    expect(agent._outSocket.destroy).not.toHaveBeenCalled();

    loopIteration(99);
    expect(agent._outSocket.destroy).not.toHaveBeenCalled();

    loopIteration(1);
    expect(agent._outSocket.destroy).toHaveBeenCalledTimes(1);
  });

  it("closes after a stall when no output was buffered", () => {
    const agent = makeAgent();
    flush(agent);

    loopIteration(150);
    expect(agent._outSocket.destroy).toHaveBeenCalledTimes(1);
  });
});
