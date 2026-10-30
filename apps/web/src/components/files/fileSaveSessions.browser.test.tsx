import { render, fakeTimers } from "../../../test/render";
import { EnvironmentId } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

const { runAtomCommand, getUnsavedFile } = vi.hoisted(() => ({
  runAtomCommand: vi.fn(),
  getUnsavedFile: vi.fn(),
}));
vi.mock(import("@supaterm/client-runtime/state/runtime"), async (original) => ({
  ...(await original()),
  runAtomCommand: runAtomCommand as never,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));
vi.mock(import("./projectFilesQueryState"), async (original) => ({
  ...(await original()),
  confirmProjectFileQueryData: () => true,
  getUnsavedProjectFileQueryData: getUnsavedFile,
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
    runAtomCommand.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          finishWrite = () => resolve(AsyncResult.success(undefined));
        }),
    );
    getUnsavedFile.mockReset().mockReturnValue(null);
    await using screen = await render(
      <StrictMode>
        <EditorSurface />
      </StrictMode>,
      { router: false },
    );
    using _timers = fakeTimers();

    getUnsavedFile.mockReturnValue({ contents: "draft" });
    changeFileSaveSession(target, "draft");

    await screen.rerender(
      <StrictMode>
        <MarkdownSurface />
      </StrictMode>,
    );
    finishWrite();
    getUnsavedFile.mockReturnValue(null);
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
