import * as NodeEvents from "node:events";
import * as NodeVM from "node:vm";
import { expect, it, vi } from "vite-plus/test";
import { watchMacSettingsWindow } from "./MacSettingsWindow.ts";

function makeWatcher() {
  const child = Object.assign(new NodeEvents.EventEmitter(), {
    stdout: Object.assign(new NodeEvents.EventEmitter(), { setEncoding: () => undefined }),
    kill: vi.fn(),
  });
  const spawned: Array<[string, ReadonlyArray<string>]> = [];
  const spawn = (command: string, args: ReadonlyArray<string>) => {
    spawned.push([command, args]);
    return child;
  };
  return { child, spawn, spawned };
}

it("decodes partial updates and stops the one watcher process on disposal", () => {
  const { child, spawn } = makeWatcher();
  const changed = vi.fn();
  const unavailable = vi.fn();
  const stop = watchMacSettingsWindow(changed, unavailable, spawn);
  const state = { x: 10, y: 20, width: 723, height: 719, frontmost: true };
  const line = JSON.stringify(state);
  child.stdout.emit("data", line.slice(0, 8));
  expect(changed).not.toHaveBeenCalled();
  child.stdout.emit("data", line.slice(8) + "\nnull\n");
  expect(changed.mock.calls).toEqual([[state], [null]]);
  stop();
  expect(child.kill).toHaveBeenCalledOnce();
  child.emit("exit", 0);
  expect(changed).toHaveBeenCalledTimes(2);
});
it("distinguishes unavailable tracking from a valid absent window", () => {
  const { child, spawn } = makeWatcher();
  const changed = vi.fn();
  const unavailable = vi.fn();
  const stop = watchMacSettingsWindow(changed, unavailable, spawn);
  child.stdout.emit("data", '{"x":"bad"}\n');
  expect(changed).not.toHaveBeenCalled();
  expect(unavailable).toHaveBeenCalledOnce();
  child.emit("error", new Error("spawn failed"));
  expect(changed).not.toHaveBeenCalled();
  expect(unavailable).toHaveBeenCalledTimes(2);
  stop();
});
it("polls while its parent lives and stops after reparenting to launchd", () => {
  const { spawn, spawned } = makeWatcher();
  watchMacSettingsWindow(vi.fn(), vi.fn(), spawn)();
  const script = spawned.at(-1)?.[1][3];
  const imports = new Set<string>();
  const writeData = vi.fn();
  const poll = vi.fn(() => ({ count: 0 }));
  const sleep = vi.fn(() => {
    if (sleep.mock.calls.length > 2) throw new Error("tracker kept polling after parent exit");
  });
  const bridge = Object.assign((line: string) => ({ dataUsingEncoding: () => line }), {
    getppid: () => {
      if (!imports.has("unistd")) throw new Error("unistd bridge unavailable");
      return sleep.mock.calls.length < 2 ? 42 : 1;
    },
    NSRunningApplication: { runningApplicationsWithBundleIdentifier: poll },
    NSFileHandle: { fileHandleWithStandardOutput: { writeData } },
    NSThread: { sleepForTimeInterval: sleep },
    NSUTF8StringEncoding: 4,
  });
  NodeVM.runInNewContext(script + "\nrun();", {
    ObjC: { import: (name: string) => imports.add(name) },
    $: bridge,
  });
  expect(poll).toHaveBeenCalledTimes(2);
  expect(writeData.mock.calls).toEqual([["null\n"]]);
});
