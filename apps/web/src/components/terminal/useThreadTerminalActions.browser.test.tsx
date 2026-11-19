import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const commands = vi.hoisted(() => ({
  open: fake(),
  write: fake(),
  close: fake(),
}));

vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProject: (() => ({ workspaceRoot: "/repo" })) as never,
  useQuietThreadShell: ((threadRef: ScopedThreadRef | null) =>
    threadRef
      ? { ...threadRef, projectId: ProjectId.make("project"), worktreePath: null }
      : null) as never,
}));
vi.mock(import("../../state/terminalSessions"), async (original) => ({
  ...(await original()),
  useKnownTerminalSessions: () => [],
}));
vi.mock(import("../../state/terminal"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    terminalEnvironment: {
      ...actual.terminalEnvironment,
      open: "open",
      write: "write",
      close: "close",
    } as unknown as typeof actual.terminalEnvironment,
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: keyof typeof commands) => commands[command]) as never,
}));

import { useThreadTerminalActions } from "./useThreadTerminalActions";

const environmentId = EnvironmentId.make("environment");
const threadRef = (threadId: string): ScopedThreadRef => ({
  environmentId,
  threadId: ThreadId.make(threadId),
});

describe("useThreadTerminalActions", () => {
  it("writes to the thread a terminal was launched in after the user switches threads", async () => {
    commands.open.implement(async () => AsyncResult.success(undefined));
    commands.write.implement(async () => AsyncResult.success(undefined));
    const actions: { current?: ReturnType<typeof useThreadTerminalActions> } = {};
    function Harness({ thread }: { thread: ScopedThreadRef }) {
      const threadActions = useThreadTerminalActions(thread);
      useEffect(() => {
        actions.current = threadActions;
      });
      return null;
    }

    await using screen = await render(<Harness thread={threadRef("first")} />);
    const launched = actions.current!.launchTerminal({ place: () => {}, terminalId: "term-1" });
    await screen.rerender(<Harness thread={threadRef("second")} />);
    await launched!.write("echo hi\r");

    expect(commands.write).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId: ThreadId.make("first"), terminalId: "term-1", data: "echo hi\r" },
    });
  });
});
