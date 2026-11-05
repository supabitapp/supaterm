import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const SidePulseSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  brightness: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(100)),
  ),
});
export type SidePulseSettings = typeof SidePulseSettings.Type;

/** Ordered from least to most urgent; the LEDs show the most urgent state of any thread. */
export const SIDE_PULSE_LED_STATES = ["idle", "done", "working", "attention"] as const;
export const SidePulseLedState = Schema.Literals(SIDE_PULSE_LED_STATES);
export type SidePulseLedState = typeof SidePulseLedState.Type;

export const SidePulseDeviceError = Schema.Literals(["access-denied", "read-only", "write-failed"]);
export type SidePulseDeviceError = typeof SidePulseDeviceError.Type;

export const SidePulseDevice = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  error: Schema.NullOr(SidePulseDeviceError),
});
export type SidePulseDevice = typeof SidePulseDevice.Type;

export const SidePulseDeviceState = Schema.Struct({
  enabled: Schema.Boolean,
  devices: Schema.Array(SidePulseDevice),
  /** Null while no Supaterm window is reporting thread state, which turns the LEDs off. */
  ledState: Schema.NullOr(SidePulseLedState),
});
export type SidePulseDeviceState = typeof SidePulseDeviceState.Type;

export interface DesktopSidePulseBridge {
  getState: () => Promise<SidePulseDeviceState>;
  onStateChange: (listener: (state: SidePulseDeviceState) => void) => () => void;
  /** Null when this window stops reporting thread state, which turns the LEDs off. */
  setLedState: (state: SidePulseLedState | null) => Promise<void>;
}
