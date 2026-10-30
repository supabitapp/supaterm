import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  consumePendingTerminalFocus,
  focusTerminal,
  registerTerminalFocusTarget,
} from "./terminalFocus";

const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread"));

describe("terminal focus requests", () => {
  it("targets the requested pane when two viewports show the same terminal", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const stopFirst = registerTerminalFocusTarget({
      threadRef,
      terminalId: "one",
      paneId: "a",
      focus: first,
    });
    const stopSecond = registerTerminalFocusTarget({
      threadRef,
      terminalId: "one",
      paneId: "b",
      focus: second,
    });
    try {
      focusTerminal(threadRef, "one", "b");
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledOnce();
    } finally {
      stopFirst();
      stopSecond();
    }
  });

  it("waits for the requested viewport to become operable", () => {
    let ready = false;
    const focus = vi.fn(() => ready);
    const stop = registerTerminalFocusTarget({
      threadRef,
      terminalId: "waiting",
      paneId: "a",
      focus,
    });
    try {
      focusTerminal(threadRef, "waiting", "a");
      ready = true;
      consumePendingTerminalFocus(threadRef, "waiting", "b");
      expect(focus).toHaveBeenCalledTimes(1);
      consumePendingTerminalFocus(threadRef, "waiting", "a");
      expect(focus).toHaveBeenCalledTimes(2);
      consumePendingTerminalFocus(threadRef, "waiting", "a");
      expect(focus).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it("drops an older request when a different terminal is requested", () => {
    const old = vi.fn(() => true);
    focusTerminal(threadRef, "old", "a");
    focusTerminal(threadRef, "new", "b");
    const stop = registerTerminalFocusTarget({
      threadRef,
      terminalId: "old",
      paneId: "a",
      focus: old,
    });
    try {
      consumePendingTerminalFocus(threadRef, "old", "a");
      expect(old).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});
