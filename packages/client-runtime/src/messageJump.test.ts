import { RunId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import { nextMessageJumpStep } from "./messageJump.ts";

const runId = RunId.make("run-1");
const base = {
  rowIndex: -1,
  loaded: false,
  foldRunId: null,
  cursor: "message-10",
  history: { loading: false, hasMoreHistory: true, error: null },
  progress: { requestedCursors: new Set<string>(), expandedRunId: null },
};

describe("nextMessageJumpStep", () => {
  it("scrolls to a message that has a row", () => {
    expect(nextMessageJumpStep({ ...base, rowIndex: 4, loaded: true })).toEqual({
      type: "scroll",
      index: 4,
    });
  });

  it("unfolds the turn hiding a loaded message once", () => {
    expect(nextMessageJumpStep({ ...base, loaded: true, foldRunId: runId })).toEqual({
      type: "expand",
      runId,
    });
    expect(
      nextMessageJumpStep({
        ...base,
        loaded: true,
        foldRunId: runId,
        progress: { ...base.progress, expandedRunId: runId },
      }),
    ).toEqual({ type: "missing" });
  });

  it("pages earlier history through each cursor once", () => {
    expect(nextMessageJumpStep(base)).toEqual({ type: "load-earlier", cursor: "message-10" });
    expect(
      nextMessageJumpStep({
        ...base,
        progress: { ...base.progress, requestedCursors: new Set(["message-10"]) },
      }),
    ).toEqual({ type: "missing" });
  });

  it("waits for a page in flight and gives up when history is exhausted or failing", () => {
    expect(nextMessageJumpStep({ ...base, history: { ...base.history, loading: true } })).toEqual({
      type: "wait",
    });
    expect(
      nextMessageJumpStep({ ...base, history: { ...base.history, hasMoreHistory: false } }),
    ).toEqual({ type: "missing" });
    expect(
      nextMessageJumpStep({ ...base, history: { ...base.history, error: "offline" } }),
    ).toEqual({ type: "missing" });
    expect(nextMessageJumpStep({ ...base, history: undefined })).toEqual({ type: "missing" });
  });
});
