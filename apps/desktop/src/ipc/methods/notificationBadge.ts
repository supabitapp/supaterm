import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HostProcess from "@supaterm/shared/HostProcess";

import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_NOTIFICATION_BADGE_CHANNEL } from "../channels.ts";

const NotificationBadge = Schema.Struct({
  count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2_147_483_647 })),
  image: Schema.NullOr(
    Schema.String.check(
      Schema.isMaxLength(16_384),
      Schema.isPattern(/^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i),
    ),
  ),
});

type NotificationBadgeWindow = {
  readonly isDestroyed: () => boolean;
  readonly setOverlayIcon: (overlay: Electron.NativeImage | null, description: string) => void;
  readonly webContents: { readonly send: (channel: string) => void };
};

export type NotificationBadgeNative = {
  readonly hasFocusedWindow: () => boolean;
  readonly getAllWindows: () => ReadonlyArray<NotificationBadgeWindow>;
  readonly createFromDataURL: (dataUrl: string) => Electron.NativeImage;
  readonly setBadgeCount: (count: number) => void;
};

const electronNotificationBadgeNative: NotificationBadgeNative = {
  hasFocusedWindow: () => Electron.BrowserWindow.getFocusedWindow() !== null,
  getAllWindows: () => Electron.BrowserWindow.getAllWindows(),
  createFromDataURL: (dataUrl) => Electron.nativeImage.createFromDataURL(dataUrl),
  setBadgeCount: (count) => {
    Electron.app.setBadgeCount(count);
  },
};

function applyNotificationBadge(
  native: NotificationBadgeNative,
  platform: NodeJS.Platform,
  { count, image }: typeof NotificationBadge.Type,
) {
  try {
    if (native.hasFocusedWindow()) count = 0;
    if (platform === "win32") {
      const overlay = count > 0 && image ? native.createFromDataURL(image) : null;
      for (const window of native.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.setOverlayIcon(
            overlay?.isEmpty() ? null : overlay,
            count > 0 ? `${count} threads with new notifications` : "",
          );
        }
      }
    } else if (platform === "darwin" || platform === "linux") {
      native.setBadgeCount(count);
    }
  } catch (error) {
    Effect.runSync(Effect.logWarning("Could not update notification badge", error));
  }
}

export const installNotificationBadge = Effect.fn("desktop.ipc.installNotificationBadge")(
  function* (native: NotificationBadgeNative = electronNotificationBadgeNative) {
    const ipc = yield* DesktopIpc.DesktopIpc;
    const app = yield* ElectronApp.ElectronApp;
    const platform = yield* HostProcess.Platform;
    const clear = () => {
      applyNotificationBadge(native, platform, { count: 0, image: null });
      for (const window of native.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(SET_NOTIFICATION_BADGE_CHANNEL);
      }
    };
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: SET_NOTIFICATION_BADGE_CHANNEL,
        payload: NotificationBadge,
        result: Schema.Void,
        handler: (badge) =>
          Effect.sync(() => {
            if (badge.count > 0 && native.hasFocusedWindow()) clear();
            else applyNotificationBadge(native, platform, badge);
          }),
      }),
    );
    yield* app.on("browser-window-focus", clear);
    yield* app.on("before-quit", clear);
    yield* Effect.addFinalizer(() => Effect.sync(clear));
  },
);
