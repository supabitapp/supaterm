import {
  CodexMicroDeviceState,
  CodexMicroLightingModel,
  type CodexMicroInputEvent,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as CodexMicro from "../../codexMicro/CodexMicro.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const installCodexMicroEventForwarding = Effect.fn(
  "desktop.ipc.codexMicro.installEventForwarding",
)(function* () {
  const codexMicro = yield* CodexMicro.CodexMicro;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* codexMicro.subscribeState((state) =>
    electronWindow.sendAll(IpcChannels.CODEX_MICRO_STATE_CHANNEL, state),
  );
  // Only the main window runs the keyboard coordinator, so input never goes to other windows.
  yield* codexMicro.subscribeInput(
    Effect.fn("desktop.ipc.codexMicro.forwardInput")(
      function* (event) {
        const focus = event.type === "agent-key" && event.focus;
        const main = Option.filter(yield* electronWindow.main, (window) => !window.isDestroyed());
        if (Option.isSome(main)) {
          sendWhenLoaded(main.value, event);
          if (focus) yield* electronWindow.reveal(main.value);
        } else if (focus) {
          sendWhenLoaded(yield* desktopWindow.revealOrCreateMain, event);
        }
      },
      (effect) => effect.pipe(Effect.ignoreCause),
    ),
  );
});

function sendWhenLoaded(window: Electron.BrowserWindow, event: CodexMicroInputEvent) {
  const send = () => {
    if (!window.isDestroyed())
      window.webContents.send(IpcChannels.CODEX_MICRO_INPUT_CHANNEL, event);
  };
  if (window.webContents.isLoadingMainFrame()) window.webContents.once("did-finish-load", send);
  else send();
}

export const getCodexMicroState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CODEX_MICRO_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: CodexMicroDeviceState,
  handler: Effect.fn("desktop.ipc.codexMicro.getState")(function* () {
    return yield* (yield* CodexMicro.CodexMicro).state;
  }),
});

export const setCodexMicroLighting = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CODEX_MICRO_SET_LIGHTING_CHANNEL,
  payload: CodexMicroLightingModel,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.codexMicro.setLighting")(function* (model, event) {
    // Only the main window owns the keyboard; other windows would fight over its lights.
    const main = yield* (yield* ElectronWindow.ElectronWindow).main;
    if (
      event === undefined ||
      Option.isNone(main) ||
      main.value.webContents.id !== event.sender.id
    ) {
      return;
    }
    yield* (yield* CodexMicro.CodexMicro).setLighting(model);
  }),
});

export const openCodexMicroInputMonitoringSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CODEX_MICRO_OPEN_INPUT_MONITORING_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.codexMicro.openInputMonitoringSettings")(function* () {
    yield* (yield* CodexMicro.CodexMicro).openInputMonitoringSettings;
  }),
});
