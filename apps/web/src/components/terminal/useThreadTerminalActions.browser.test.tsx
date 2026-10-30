import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

const commands = vi.hoisted(() => ({
  open: vi.fn(),
  write: vi.fn(),
  close: vi.fn(),
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
    commands.open.mockResolvedValue(AsyncResult.success(undefined));
    commands.write.mockResolvedValue(AsyncResult.success(undefined));
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
