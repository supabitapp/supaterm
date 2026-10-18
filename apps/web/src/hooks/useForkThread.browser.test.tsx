import { EnvironmentId, RunId, ThreadId } from "@supaterm/contracts";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  connected: true,
  permitted: true,
  fork: vi.fn(async (_input: unknown) => ({ _tag: "Success" })),
  ready: vi.fn(async (_ref: unknown) => true),
  navigate: vi.fn(async (_input: unknown) => undefined),
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironment: (() => ({
    connection: { phase: state.connected ? "connected" : "disconnected" },
  })) as never,
}));
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => state.permitted,
}));
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.fork) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  waitForThreadShell: state.ready as never,
}));

import { useForkThread } from "./useForkThread";

const thread = {
  environmentId: EnvironmentId.make("ssh-environment"),
  id: ThreadId.make("current-fork"),
  title: "A conversation",
};
const source = { sourceThreadId: ThreadId.make("inherited-source"), runId: RunId.make("run") };
let root: Root | null = null;
let action: ReturnType<typeof useForkThread>;

function Probe({ disabled }: { disabled: boolean }) {
  const result = useForkThread(thread, disabled);
  useEffect(() => {
    action = result;
  });
  return null;
}

async function render(disabled = false) {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(<Probe disabled={disabled} />));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.connected = true;
  state.permitted = true;
  state.fork.mockClear();
  state.ready.mockReset().mockResolvedValue(true);
  state.navigate.mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

it("forks inherited history in the viewed environment and waits before navigation", async () => {
  await render();
  let resolveReady: (value: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => {
    resolveReady = resolve;
  });
  state.ready.mockReturnValueOnce(ready);
  await act(async () => {
    const pending = action.onForkFromRun(source);
    await action.onForkFromRun(source);
    expect(state.fork).toHaveBeenCalledTimes(1);
    expect(state.fork).toHaveBeenCalledWith({
      environmentId: thread.environmentId,
      input: { ...source, targetThreadId: expect.any(String), title: "A conversation fork" },
    });
    expect(state.navigate).not.toHaveBeenCalled();
    resolveReady(true);
    await pending;
  });
  const [{ input }] = state.fork.mock.calls[0] as [{ input: { targetThreadId: string } }];
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId: thread.environmentId, threadId: input.targetThreadId },
  });
  expect(action.disabled).toBe(false);
});

it("does not submit when rewinding, disconnected, or without permission", async () => {
  for (const [disabled, connected, permitted] of [
    [true, true, true],
    [false, false, true],
    [false, true, false],
  ] as const) {
    state.connected = connected;
    state.permitted = permitted;
    await render(disabled);
    expect(action.disabled).toBe(true);
    await act(() => action.onForkFromRun(source));
  }
  expect(state.fork).not.toHaveBeenCalled();
});

it("reports a missing thread shell and lets the user retry after failure", async () => {
  await render();
  state.ready.mockResolvedValueOnce(false);
  await act(async () => {
    await expect(action.onForkFromRun(source)).rejects.toThrow("The fork was created");
  });
  expect(state.navigate).not.toHaveBeenCalled();
  expect(action.disabled).toBe(false);
  await act(() => action.onForkFromRun(source));
  expect(state.fork).toHaveBeenCalledTimes(2);
  expect(state.navigate).toHaveBeenCalledTimes(1);
});
