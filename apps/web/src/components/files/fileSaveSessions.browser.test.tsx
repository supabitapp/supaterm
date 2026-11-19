import { render, fakeTimers } from "../../../test/render";
import { type AuthSessionState, EnvironmentId } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

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
const { runAtomCommand, getUnsavedFile } = vi.hoisted(() => ({
  runAtomCommand: fake(),
  getUnsavedFile: fake(),
}));
vi.mock(import("@supaterm/client-runtime/state/runtime"), async (original) => ({
  ...(await original()),
  runAtomCommand: runAtomCommand as never,
}));
vi.mock(import("~/state/session"), async (original) => {
  const actual = await original();
  const reactivity = await import("effect/reactivity");
  const signedOut = reactivity.Atom.make(reactivity.AsyncResult.initial<AuthSessionState>());
  return {
    ...actual,
    environmentSession: { ...actual.environmentSession, sessionStateAtom: () => signedOut },
    readEnvironmentScope: () => true,
  };
});
vi.mock(import("./projectFilesQueryState"), async (original) => ({
  ...(await original()),
  confirmProjectFileQueryData: (() => true) as never,
  getUnsavedProjectFileQueryData: getUnsavedFile as never,
}));

import { changeFileSaveSession, useFileSaveSession } from "./fileSaveSessions";

const target = {
  environmentId: EnvironmentId.make("file-save-sessions-browser"),
  cwd: "/workspace",
  relativePath: "README.md",
};
const onPendingChange = vi.fn();

function EditorSurface() {
  useFileSaveSession({ ...target }, onPendingChange);
  return <div>editor</div>;
}
function MarkdownSurface() {
  useFileSaveSession({ ...target }, onPendingChange);
  return <div>markdown</div>;
}

describe("file save sessions in React", () => {
  it("writes a pending draft once when the file switches surfaces under StrictMode", async () => {
    let finishWrite = () => {};
    runAtomCommand.reset(
      () =>
        new Promise((resolve) => {
          finishWrite = () => resolve(AsyncResult.success(undefined));
        }),
    );
    getUnsavedFile.reset(() => null);
    await using screen = await render(
      <StrictMode>
        <EditorSurface />
      </StrictMode>,
      { router: false },
    );
    using _timers = fakeTimers();
    getUnsavedFile.implement(() => ({ contents: "draft" }));
    changeFileSaveSession(target, "draft");

    await screen.rerender(
      <StrictMode>
        <MarkdownSurface />
      </StrictMode>,
    );
    finishWrite();
    getUnsavedFile.implement(() => null);
    await vi.runAllTimersAsync();

    expect(runAtomCommand.mock.calls.map(([, , request]) => request)).toEqual([
      {
        environmentId: target.environmentId,
        input: { cwd: "/workspace", relativePath: "README.md", contents: "draft" },
      },
    ]);
    expect(onPendingChange).toHaveBeenLastCalledWith("README.md", false);
  });
});
