import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  type CommandInvocation,
  dispatchMenuAction,
  observeKeyDown,
  registerCommands,
  registerMenuAction,
  runCommand,
} from "./dispatcher";

function bindings(entries: ReadonlyArray<[string, KeybindingCommand]>): ResolvedKeybindingsConfig {
  return entries.map(([key, command]) => ({
    command,
    shortcut: {
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      modKey: false,
    },
  }));
}

const keybindings = () =>
  bindings([
    ["k", "chat.new"],
    ["j", "chat.newLocal"],
  ]);

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
  window.dispatchEvent(event);
  return event;
}

describe("command dispatcher", () => {
  it("runs the newest scope's handler and nothing below it", () => {
    const global = vi.fn();
    const outer = vi.fn();
    const inner = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.new": global }, { keybindings }));
    stack.defer(registerCommands({ "chat.new": outer }, { keybindings }));
    stack.defer(registerCommands({ "chat.new": inner }, { keybindings }));

    expect(press("k").defaultPrevented).toBe(true);

    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
  });

  it("falls through scopes that return false, skip the command, or fail their guard", () => {
    const global = vi.fn();
    const declined = vi.fn(() => false);
    const guarded = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.new": global }, { keybindings }));
    stack.defer(registerCommands({ "chat.new": declined }, { keybindings }));
    stack.defer(registerCommands({ "chat.newLocal": vi.fn() }, { keybindings }));
    stack.defer(registerCommands({ "chat.new": guarded }, { keybindings, when: () => false }));

    press("k");

    expect(guarded).not.toHaveBeenCalled();
    expect(declined).toHaveBeenCalledOnce();
    expect(global).toHaveBeenCalledOnce();
  });

  it("stops once a handler prevents default, and unregisters on cleanup", () => {
    const lower = vi.fn();
    const upper = vi.fn(({ event }: CommandInvocation) => {
      event?.preventDefault();
      return false;
    });
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.new": lower }, { keybindings }));
    const unregisterUpper = registerCommands({ "chat.new": upper }, { keybindings });

    press("k");
    expect(lower).not.toHaveBeenCalled();

    unregisterUpper();
    press("k");
    expect(upper).toHaveBeenCalledOnce();
    expect(lower).toHaveBeenCalledOnce();
  });

  it("leaves keys typed into a shortcut recorder alone", () => {
    const command = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.new": command }, { keybindings }));
    const recorder = document.createElement("input");
    recorder.dataset.keybindingCapture = "";
    document.body.append(recorder);
    stack.defer(() => recorder.remove());

    const event = new KeyboardEvent("keydown", { key: "k", cancelable: true, bubbles: true });
    recorder.dispatchEvent(event);

    expect(command).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("runs commands without a key through the same scopes and guards, capture scopes first", () => {
    const calls: Array<string> = [];
    let captureLive = false;
    using stack = new DisposableStack();
    stack.defer(
      registerCommands({ "chat.new": ({ source }) => void calls.push(`global:${source}`) }),
    );
    stack.defer(
      registerCommands(
        { "chat.new": ({ source }) => void calls.push(`capture:${source}`) },
        { capture: true, when: () => captureLive },
      ),
    );

    expect(runCommand("chat.new", "device")).toBe(true);
    captureLive = true;
    dispatchMenuAction("chat.new");

    expect(calls).toEqual(["global:device", "capture:menu"]);
    expect(runCommand("chat.newLocal", "device")).toBe(false);
  });

  it("lets a scope claim raw keys before command lookup", () => {
    const onEscape = vi.fn((event: KeyboardEvent) => (event.key === "Escape" ? undefined : false));
    const command = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.new": command }, { keybindings, onKeyDown: onEscape }));

    press("Escape");
    press("k");

    expect(onEscape).toHaveBeenCalledTimes(2);
    expect(command).toHaveBeenCalledOnce();
  });

  it("tells observers whether a scope consumed the key, after the scopes ran", () => {
    const calls: Array<string> = [];
    using stack = new DisposableStack();
    stack.defer(observeKeyDown((_event, consumed) => void calls.push(`observe:${consumed}`)));
    stack.defer(
      registerCommands({ "chat.new": () => void calls.push("command") }, { keybindings }),
    );

    press("k");
    const unconsumed = press("x");

    expect(calls).toEqual(["command", "observe:true", "observe:false"]);
    expect(unconsumed.defaultPrevented).toBe(false);
  });

  it("consumes a command chord pressed inside a confirmation without running its handler", () => {
    const command = vi.fn();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    const cancel = document.createElement("button");
    dialog.append(cancel);
    document.body.append(dialog);
    using stack = new DisposableStack();
    stack.defer(() => dialog.remove());
    stack.defer(registerCommands({ "chat.new": command }, { keybindings }));
    cancel.focus();

    const event = new KeyboardEvent("keydown", { key: "k", cancelable: true, bubbles: true });
    cancel.dispatchEvent(event);

    expect(command).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("routes a menu action to its newest handler", () => {
    const older = vi.fn();
    const newer = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerMenuAction("test-action", older));
    const unregisterNewer = registerMenuAction("test-action", newer);

    dispatchMenuAction("test-action");
    unregisterNewer();
    dispatchMenuAction("test-action");

    expect(newer).toHaveBeenCalledOnce();
    expect(older).toHaveBeenCalledOnce();
  });
});
