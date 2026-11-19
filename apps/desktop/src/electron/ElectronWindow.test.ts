import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

import * as ElectronWindow from "./ElectronWindow.ts";
import type { WindowsForegroundFocusTarget } from "./WindowsForegroundFocusThread.ts";

type ForegroundApi = { readonly getForegroundWindow: () => bigint };

function makeNative() {
  const initialForegroundApi: () => Promise<ForegroundApi> = () =>
    Promise.resolve({ getForegroundWindow: () => 0n });
  const state = {
    allWindows: [] as ReadonlyArray<unknown>,
    createdWindows: [] as Array<unknown>,
    activateFailures: [] as Array<Error>,
    loadForegroundApi: initialForegroundApi,
  };
  const prepared: Array<WindowsForegroundFocusTarget> = [];
  const focused: Array<WindowsForegroundFocusTarget> = [];
  const native: ElectronWindow.ElectronWindowNative = {
    createWindow: () => state.createdWindows.shift() as Electron.BrowserWindow,
    getAllWindows: () => state.allWindows as ReadonlyArray<Electron.BrowserWindow>,
    getFocusedWindow: () => null,
    focusApp: () => undefined,
    dipToScreenRect: (_window, rect) => ({
      x: rect.x * 2,
      y: rect.y * 2,
      width: rect.width * 2,
      height: rect.height * 2,
    }),
    activateWindowsForeground: async () => {
      const failure = state.activateFailures.shift();
      if (failure) throw failure;
    },
    isWindowsShellHostedForeground: async () => false,
    loadWindowsForegroundApi: () => state.loadForegroundApi(),
    startWindowsForegroundFocusThread: () => ({
      prepare: async (target) => {
        prepared.push(target);
        return false;
      },
      focus: async (target) => {
        focused.push(target);
        return false;
      },
      close: () => undefined,
    }),
  };
  return { native, state, prepared, focused };
}

const layerTestFor = (native: ElectronWindow.ElectronWindowNative, platform: NodeJS.Platform) =>
  Layer.effect(ElectronWindow.ElectronWindow, ElectronWindow.makeWith(native)).pipe(
    Layer.provide(Layer.succeed(HostProcess.Platform, platform)),
  );

function makeWindowsRevealWindow() {
  const state = { destroyed: false };
  const window = {
    id: 41,
    isDestroyed: () => state.destroyed,
    isFocused: () => false,
    isMinimized: () => false,
    isVisible: () => true,
    show: () => undefined,
    moveTop: () => undefined,
    focus: () => undefined,
    getTitle: () => "Supaterm (Dev)",
    getBounds: () => ({ x: 100, y: 50, width: 1_200, height: 800 }),
    getContentBounds: () => ({ x: 108, y: 50, width: 1_184, height: 792 }),
    getNativeWindowHandle: () => Buffer.from([41, 0, 0, 0]),
    restore: () => undefined,
  };
  return {
    state,
    window,
    getTitle: vi.spyOn(window, "getTitle"),
    getNativeWindowHandle: vi.spyOn(window, "getNativeWindowHandle"),
  };
}

describe("ElectronWindow", () => {
  it.effect("cancels native focus when destroyed during the foreground query", () => {
    const { native, state, prepared, focused } = makeNative();
    return Effect.gen(function* () {
      const reveal = makeWindowsRevealWindow();
      const window = reveal.window as unknown as Electron.BrowserWindow;
      state.activateFailures.push(new Error("Windows initially refused foreground activation"));
      const queryStarted = Promise.withResolvers<void>();
      const foreground = Promise.withResolvers<ForegroundApi>();
      state.loadForegroundApi = () => {
        queryStarted.resolve();
        return foreground.promise;
      };
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      yield* electronWindow.prepareReveal(window);
      assert.deepEqual(prepared[0], {
        windowId: 41,
        processId: process.pid,
        title: "Supaterm (Dev)",
        bounds: { x: 200, y: 100, width: 2_400, height: 1_600 },
        contentBounds: { x: 216, y: 100, width: 2_368, height: 1_584 },
      });
      reveal.getTitle.mockClear();

      const revealFiber = yield* electronWindow
        .reveal(window)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.promise(() => queryStarted.promise);
      reveal.state.destroyed = true;
      foreground.resolve({ getForegroundWindow: () => 0n });
      yield* Fiber.join(revealFiber);

      assert.lengthOf(focused, 0);
      assert.lengthOf(reveal.getNativeWindowHandle.mock.calls, 1);
      assert.lengthOf(reveal.getTitle.mock.calls, 0);
    }).pipe(Effect.provide(layerTestFor(native, "win32")));
  });

  it.effect("reports which windows were created with a title bar overlay", () => {
    const { native, state } = makeNative();
    return Effect.gen(function* () {
      const framed = { isDestroyed: () => false };
      const overlay = { isDestroyed: () => false };
      state.createdWindows.push(framed, overlay);
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      yield* electronWindow.create({});
      yield* electronWindow.create({
        titleBarStyle: "hidden",
        titleBarOverlay: { color: "#01000000", height: 40 },
      });
      state.allWindows = [framed, overlay, { isDestroyed: () => false }];

      const seen: Array<boolean> = [];
      yield* electronWindow.syncAllAppearance((_window, { titleBarOverlay }) =>
        Effect.sync(() => seen.push(titleBarOverlay)),
      );

      assert.deepEqual(seen, [false, true, false]);
    }).pipe(Effect.provide(layerTestFor(native, "win32")));
  });

  it.effect("preserves destroy failures and continues with later windows", () => {
    const { native, state } = makeNative();
    return Effect.gen(function* () {
      const cause = new Error("window destroy failed");
      const window = {
        id: 43,
        destroy: () => {
          throw cause;
        },
      };
      const laterWindow = { id: 44, destroy: () => undefined };
      const laterDestroy = vi.spyOn(laterWindow, "destroy");
      state.allWindows = [window, laterWindow];

      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const exit = yield* Effect.exit(electronWindow.destroyAll);

      assert.equal(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, ElectronWindow.ElectronWindowOperationError);
        assert.equal(error.operation, "destroy-window");
        assert.equal(error.windowId, 43);
        assert.isNull(error.channel);
        assert.strictEqual(error.cause, cause);
      }
      assert.equal(laterDestroy.mock.calls.length, 1);
    }).pipe(Effect.provide(layerTestFor(native, "linux")));
  });

  it.effect("never falls back to an auxiliary window as the main window", () => {
    const { native, state } = makeNative();
    return Effect.gen(function* () {
      const auxiliaryWindow = { isDestroyed: () => false };
      state.createdWindows.push(auxiliaryWindow);
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const auxiliary = yield* electronWindow.create({}, { auxiliary: true });
      const ordinary = { isDestroyed: () => false } as unknown as Electron.BrowserWindow;

      state.allWindows = [auxiliary];
      assert.isTrue((yield* electronWindow.currentMainOrFirst)._tag === "None");

      state.allWindows = [auxiliary, ordinary];
      const current = yield* electronWindow.currentMainOrFirst;
      assert.isTrue(current._tag === "Some" && current.value === ordinary);
    }).pipe(Effect.provide(layerTestFor(native, "linux")));
  });
});
