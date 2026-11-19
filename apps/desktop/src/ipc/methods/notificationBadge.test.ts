import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import type * as Electron from "electron";

import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { installNotificationBadge, type NotificationBadgeNative } from "./notificationBadge.ts";

const badge = { count: 2, image: "data:image/png;base64,aGVsbG8=" };

function makeNative() {
  const state = { focused: false };
  const badgeCounts: Array<number> = [];
  const sent: Array<string> = [];
  const listeners = new Map<string, () => void>();
  const window = {
    isDestroyed: () => false,
    setOverlayIcon: () => undefined,
    webContents: {
      send: (channel: string) => {
        sent.push(channel);
      },
    },
  };
  const native: NotificationBadgeNative = {
    hasFocusedWindow: () => state.focused,
    getAllWindows: () => [window],
    createFromDataURL: () => ({ isEmpty: () => false }) as unknown as Electron.NativeImage,
    setBadgeCount: (count) => {
      badgeCounts.push(count);
    },
  };
  const appLayer = Layer.mock(ElectronApp.ElectronApp)({
    on: (eventName, listener) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          listeners.set(eventName, listener as () => void);
        }),
        () =>
          Effect.sync(() => {
            listeners.delete(eventName);
          }),
      ),
  });
  return { native, state, badgeCounts, sent, listeners, appLayer };
}

it.effect("validates IPC and clears on native focus, quit, and disposal", () =>
  Effect.gen(function* () {
    const fake = makeNative();
    const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* installNotificationBadge(fake.native);
        const handler = handlers.get("desktop:set-notification-badge")!;
        const event = { sender: { id: 1 } };
        for (const invalid of [
          { ...badge, count: -1 },
          { ...badge, count: 0.5 },
          { ...badge, count: Infinity },
          { ...badge, image: "https://example.com/icon.png" },
          { ...badge, image: `data:image/png;base64,${"a".repeat(16_384)}` },
        ]) {
          yield* Effect.promise(() => expect(handler(event, invalid)).rejects.toBeDefined());
        }
        expect(fake.badgeCounts).toEqual([]);
        yield* Effect.promise(() => Promise.resolve(handler(event, badge)));
        expect(fake.badgeCounts.at(-1)).toBe(2);
        fake.listeners.get("browser-window-focus")!();
        expect(fake.badgeCounts.at(-1)).toBe(0);
        expect(fake.sent).toContain("desktop:set-notification-badge");
        fake.state.focused = true;
        yield* Effect.promise(() => Promise.resolve(handler(event, badge)));
        expect(fake.badgeCounts.at(-1)).toBe(0);
        expect(fake.sent).toHaveLength(2);
        yield* Effect.promise(() => Promise.resolve(handler(event, { count: 0, image: null })));
        expect(fake.sent).toHaveLength(2);
        fake.state.focused = false;
        yield* Effect.promise(() => Promise.resolve(handler(event, badge)));
        fake.listeners.get("before-quit")!();
        expect(fake.badgeCounts.at(-1)).toBe(0);
      }),
    ).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provide([
        fake.appLayer,
        DesktopIpc.layerTest({
          handle: (channel, handler) => {
            handlers.set(channel, handler);
          },
          removeHandler: (channel) => {
            handlers.delete(channel);
          },
          on: vi.fn(),
          removeAllListeners: vi.fn(),
        }),
      ]),
    );
    expect(fake.badgeCounts.at(-1)).toBe(0);
    expect(fake.listeners.size).toBe(0);
    expect(handlers.size).toBe(0);
  }),
);
