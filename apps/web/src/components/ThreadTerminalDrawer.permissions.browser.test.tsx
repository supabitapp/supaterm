import {
  AuthTerminalOperateScope,
  EnvironmentId,
  ThreadId,
  type AuthEnvironmentScope,
} from "@supaterm/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts/settings";
import { nextTerminalAttachSeedState } from "@supaterm/client-runtime/state/terminal";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import type {
  GhosttyTerminalSurface,
  GhosttyTerminalSurfaceOptions,
} from "~/terminal/ghostty/surface";

const state = vi.hoisted(() => ({
  allowed: true,
  listeners: new Set<() => void>(),
  resize: vi.fn(),
  otherCommand: vi.fn(),
  createSurface:
    vi.fn<
      (
        mount: HTMLElement,
        options: GhosttyTerminalSurfaceOptions,
      ) => Promise<GhosttyTerminalSurface>
    >(),
}));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => null) as never,
}));
vi.mock(import("../hooks/useSettings"), async (original) => ({
  ...(await original()),
  getClientSettings: () => DEFAULT_CLIENT_SETTINGS,
  useClientSettings: ((select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS)) as never,
}));
vi.mock(import("../editorPreferences"), async (original) => ({
  ...(await original()),
  useOpenInPreferredEditor: (() => state.otherCommand) as never,
}));
vi.mock(import("../state/terminal"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    terminalEnvironment: { ...actual.terminalEnvironment, resize: "resize" as never },
  };
});
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: unknown) =>
    command === "resize" ? state.resize : state.otherCommand) as never,
}));
vi.mock(import("../state/terminalSessions"), async (original) => ({
  ...(await original()),
  useAttachedTerminalSession: (() => session) as never,
}));
vi.mock(import("~/terminal/ghostty/surface"), async (original) => ({
  ...(await original()),
  GhosttyTerminalSurface: { create: state.createSurface } as never,
}));
vi.mock(import("../state/session"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  const readEnvironmentScope = (id: EnvironmentId | null, scope: AuthEnvironmentScope) =>
    id !== null &&
    (scope !== AuthTerminalOperateScope || id !== threadRef.environmentId || state.allowed);
  return {
    ...(await original()),
    readEnvironmentScope,
    useEnvironmentScope: (id: EnvironmentId | null, scope: AuthEnvironmentScope) =>
      useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => state.listeners.delete(listener);
        },
        () => readEnvironmentScope(id, scope),
      ),
  };
});

import { act, render } from "../../test/render";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";

const threadRef = {
  environmentId: EnvironmentId.make("secondary-terminal"),
  threadId: ThreadId.make("thread"),
};
const session = { ...nextTerminalAttachSeedState(), status: "running" as const, version: 1 };
// The mocked modules read `state`, so every test starts by resetting all of it.
function setup() {
  state.allowed = true;
  state.listeners.clear();
  state.resize.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.otherCommand.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  // A surface can report its initial grid while asynchronous WASM setup is
  // pending. Keep that unrelated setup pending while exercising its callback.
  state.createSurface.mockReset().mockReturnValue(new Promise(() => undefined));
}

it.each(["horizontal", "vertical"] as const)(
  "keeps held Kitty keys and the original surface through %s split, focus, and unsplit",
  async (splitDirection) => {
    setup();
    const { GhosttyTerminalSurface } = await vi.importActual<
      typeof import("~/terminal/ghostty/surface")
    >("~/terminal/ghostty/surface");
    const output: string[][] = [];
    state.createSurface.mockImplementation((mount, options) => {
      const data: string[] = [];
      output.push(data);
      return GhosttyTerminalSurface.create(mount, {
        ...options,
        onData: (chunk) => {
          data.push(chunk);
          options.onData(chunk);
        },
      });
    });
    const consumeShortcut = (event: KeyboardEvent) => {
      if ((event.code === "KeyD" && event.ctrlKey) || (event.code === "KeyB" && event.repeat)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // ChatView installs its capture listener before the terminal mounts.
    window.addEventListener("keydown", consumeShortcut, { capture: true });
    using _shortcut = {
      [Symbol.dispose]: () =>
        window.removeEventListener("keydown", consumeShortcut, { capture: true }),
    };
    const composer = document.createElement("textarea");
    document.body.append(composer);
    using _composer = { [Symbol.dispose]: () => composer.remove() };
    const drawer = (terminalIds: string[], direction?: "horizontal" | "vertical") => (
      <ThreadTerminalDrawer
        threadRef={threadRef}
        threadId={threadRef.threadId}
        cwd="/repo"
        height={280}
        terminalIds={terminalIds}
        activeTerminalId="original"
        terminalGroups={[
          { id: "group", terminalIds, ...(direction ? { splitDirection: direction } : {}) },
        ]}
        activeTerminalGroupId="group"
        onSplitTerminal={state.otherCommand}
        onSplitTerminalVertical={state.otherCommand}
        onNewTerminal={state.otherCommand}
        onActiveTerminalChange={state.otherCommand}
        onCloseTerminal={state.otherCommand}
        onSplitLayoutChange={() => {}}
        onHeightChange={state.otherCommand}
        onAddTerminalContext={state.otherCommand}
        keybindings={[]}
      />
    );
    const surfacesCreated = () =>
      act(async () => {
        await Promise.all(state.createSurface.mock.results.map((result) => result.value));
      });
    await using screen = await render(drawer(["original"]));
    const { container } = screen;
    await surfacesCreated();
    const original = await state.createSurface.mock.results[0]!.value;
    const disposeOriginal = vi.spyOn(original, "dispose");
    original.write("\x1b[>11u");
    const key = (type: "keydown" | "keyup", init: KeyboardEventInit) =>
      original.input.dispatchEvent(
        new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }),
      );
    original.focus();
    key("keydown", { key: "Control", code: "ControlLeft", ctrlKey: true });
    key("keydown", { key: "d", code: "KeyD", ctrlKey: true });
    await screen.rerender(drawer(["original", "split"], splitDirection));
    await surfacesCreated();
    expect(state.createSurface).toHaveBeenCalledTimes(2);
    expect(container.querySelector("textarea")).toBe(original.input);
    expect(disposeOriginal).not.toHaveBeenCalled();
    const split = await state.createSurface.mock.results[1]!.value;
    const disposeSplit = vi.spyOn(split, "dispose");
    original.focus();
    key("keyup", { key: "d", code: "KeyD", ctrlKey: true });
    key("keyup", { key: "Control", code: "ControlLeft" });

    key("keydown", { key: "b", code: "KeyB" });
    composer.focus();
    original.focus();
    key("keydown", { key: "b", code: "KeyB", repeat: true });
    key("keyup", { key: "b", code: "KeyB" });

    key("keydown", { key: "c", code: "KeyC" });
    await screen.rerender(drawer(["original"], splitDirection));
    await surfacesCreated();
    expect(state.createSurface).toHaveBeenCalledTimes(2);
    expect(container.querySelector("textarea")).toBe(original.input);
    expect(disposeOriginal).not.toHaveBeenCalled();
    expect(disposeSplit).toHaveBeenCalledOnce();
    original.focus();
    key("keyup", { key: "c", code: "KeyC" });
    expect(output).toEqual([
      ["\x1b[57442;5u", "\x1b[57442;1:3u", "\x1b[98u", "\x1b[98;1:3u", "\x1b[99u", "\x1b[99;1:3u"],
      [],
    ]);
  },
);

it("persists a dragged height once and reconciles changed preferences before disposal", async () => {
  setup();
  using _capture = vi
    .spyOn(HTMLElement.prototype, "setPointerCapture")
    .mockImplementation(() => {});
  const onHeightChange = vi.fn();
  const drawer = (height: number) => (
    <ThreadTerminalDrawer
      threadRef={threadRef}
      threadId={threadRef.threadId}
      cwd="/repo"
      height={height}
      terminalIds={[]}
      activeTerminalId=""
      terminalGroups={[]}
      activeTerminalGroupId=""
      onSplitTerminal={state.otherCommand}
      onSplitTerminalVertical={state.otherCommand}
      onNewTerminal={state.otherCommand}
      onActiveTerminalChange={state.otherCommand}
      onCloseTerminal={state.otherCommand}
      onSplitLayoutChange={state.otherCommand}
      onHeightChange={onHeightChange}
      onAddTerminalContext={state.otherCommand}
      keybindings={[]}
    />
  );
  await using screen = await render(drawer(280));
  const handle = screen.container.querySelector<HTMLElement>(".cursor-row-resize")!;
  const drag = (from: number, to: number) => {
    const init = { bubbles: true, button: 0, pointerId: 1 };
    handle.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientY: from }));
    handle.dispatchEvent(new PointerEvent("pointermove", { ...init, clientY: to }));
    handle.dispatchEvent(new PointerEvent("pointerup", init));
  };
  await act(() => drag(400, 400));
  expect(onHeightChange).not.toHaveBeenCalled();
  await act(() => drag(400, 360));
  expect(onHeightChange).toHaveBeenCalledExactlyOnceWith(320);
  await screen.rerender(drawer(320));
  expect(onHeightChange).toHaveBeenCalledOnce();
  await screen.rerender(drawer(300));
  await screen.rerender(drawer(320));
  await screen.rerender(drawer(280));
  expect(onHeightChange).toHaveBeenCalledOnce();
  await screen.unmount();
  expect(onHeightChange.mock.calls).toEqual([[320], [320]]);
});
