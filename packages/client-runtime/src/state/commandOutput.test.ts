import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  applyCommandOutputFrame,
  commandOutputUnavailable,
  EMPTY_COMMAND_OUTPUT,
} from "./commandOutput.ts";

describe("applyCommandOutputFrame", () => {
  it("continues an escape and a redraw split across appends", () => {
    let view = applyCommandOutputFrame(EMPTY_COMMAND_OUTPUT, {
      kind: "replace",
      text: "install\n12%\u001b[3",
      truncated: false,
      running: true,
    });
    expect(view.output.text).toBe("install\n12%");
    view = applyCommandOutputFrame(view, {
      kind: "append",
      text: "2m\r100%\u001b[0m\n",
      truncated: false,
      running: true,
    });
    // The colour opened before the redraw survives it.
    expect(view.output.text).toBe("install\n\u001b[0;32m100%\u001b[0m\n");
    expect(view.running).toBe(true);
  });
});

describe("commandOutputUnavailable", () => {
  const view = (text: string, running: boolean) =>
    AsyncResult.success(
      applyCommandOutputFrame(EMPTY_COMMAND_OUTPUT, {
        kind: "replace",
        text,
        truncated: false,
        running,
      }),
    );

  it("falls back when a server rejects the subscription before any output", () => {
    expect(
      commandOutputUnavailable(AsyncResult.fail("Unknown request tag: subscribeCommandOutput")),
    ).toBe(true);
    expect(
      commandOutputUnavailable(
        AsyncResult.fail("Request failed", { previousSuccess: Option.some(view("", true)) }),
      ),
    ).toBe(true);
  });

  it("keeps streaming while the first frame is on its way", () => {
    expect(commandOutputUnavailable(AsyncResult.initial(true))).toBe(false);
  });

  it("keeps a finished command with no output on the stream", () => {
    expect(commandOutputUnavailable(view("", false))).toBe(false);
  });

  it("keeps output the stream already sent when it fails later", () => {
    expect(
      commandOutputUnavailable(
        AsyncResult.fail("Connection lost", {
          previousSuccess: Option.some(view("partial\n", true)),
        }),
      ),
    ).toBe(false);
  });
});
