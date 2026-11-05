import {
  DEFAULT_CLIENT_SETTINGS,
  SidePulseDeviceState,
  SidePulseLedState,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as MainWindowOwner from "../ipc/MainWindowOwner.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as SidePulse from "./SidePulse.ts";
import * as IpcChannels from "./SidePulseChannels.ts";

const { logWarning } = makeComponentLogger("desktop-sidepulse");

const getState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SIDE_PULSE_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: SidePulseDeviceState,
  handler: Effect.fn("desktop.ipc.sidePulse.getState")(function* () {
    return yield* (yield* SidePulse.SidePulse).state;
  }),
});

const makeSetLedState = Effect.gen(function* () {
  const sidePulse = yield* SidePulse.SidePulse;
  // Without a window reporting thread state, a lit LED would go stale.
  const admit = yield* MainWindowOwner.make(sidePulse.setLedState(null));

  return DesktopIpc.makeIpcMethod({
    channel: IpcChannels.SIDE_PULSE_SET_LED_STATE_CHANNEL,
    payload: Schema.NullOr(SidePulseLedState),
    result: Schema.Void,
    handler: Effect.fn("desktop.ipc.sidePulse.setLedState")(function* (ledState, event) {
      if (yield* admit(event)) yield* sidePulse.setLedState(ledState);
    }),
  });
});

export const install = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const sidePulse = yield* SidePulse.SidePulse;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  yield* sidePulse.subscribeState((state) =>
    electronWindow.sendAll(IpcChannels.SIDE_PULSE_STATE_CHANNEL, state),
  );
  yield* ipc.handle(getState);
  yield* ipc.handle(yield* makeSetLedState);
  yield* (yield* DesktopClientSettings.DesktopClientSettings).get.pipe(
    Effect.map(
      Option.match({
        onNone: () => DEFAULT_CLIENT_SETTINGS.sidePulse,
        onSome: (settings) => settings.sidePulse,
      }),
    ),
    Effect.flatMap(sidePulse.configure),
    Effect.catchTags({
      DesktopClientSettingsReadError: (error) =>
        logWarning("could not read client settings", { operation: error.operation }),
    }),
  );
}).pipe(Effect.withSpan("desktop.sidePulse.install"));
