import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

/** Ordered from least to most urgent; the LEDs show the most urgent state of any thread. */
export const SIDE_PULSE_LED_STATES = ["idle", "done", "working", "attention"] as const;
export const SidePulseLedState = Schema.Literals(SIDE_PULSE_LED_STATES);
export type SidePulseLedState = typeof SidePulseLedState.Type;

export const SIDE_PULSE_EFFECTS = [
  "solid",
  "breathe",
  "pulse",
  "heartbeat",
  "glow",
  "roll",
  "ripple",
  "scanner",
  "twinkle",
  "rainbow",
  "spectrum",
] as const;
export const SidePulseEffect = Schema.Literals(SIDE_PULSE_EFFECTS);
export type SidePulseEffect = typeof SidePulseEffect.Type;

// A newer build's effect decodes to the state's default instead of failing the settings document.
// The fallback is a String member, not catchDecoding, which an enclosing decoding default bypasses.
const effectSetting = (fallback: SidePulseEffect) =>
  Schema.Union([
    SidePulseEffect,
    Schema.String.pipe(
      Schema.decodeTo(SidePulseEffect, {
        decode: SchemaGetter.transform(() => fallback),
        encode: SchemaGetter.forbidden(() => "Unknown SidePulse effects are decode-only."),
      }),
    ),
  ]).pipe(Schema.withDecodingDefault(Effect.succeed(fallback)));

const SidePulseEffects = Schema.Struct({
  idle: effectSetting("glow"),
  done: effectSetting("solid"),
  working: effectSetting("roll"),
  attention: effectSetting("pulse"),
});

export const SidePulseColor = Schema.String.check(Schema.isPattern(/^#[\da-f]{6}$/i));
export type SidePulseColor = typeof SidePulseColor.Type;

// Null is the light's own color. A malformed color decodes to null instead of failing the document.
const colorSetting = Schema.Union([
  Schema.NullOr(SidePulseColor),
  Schema.String.pipe(
    Schema.decodeTo(Schema.Null, {
      decode: SchemaGetter.transform(() => null),
      encode: SchemaGetter.forbidden(() => "Malformed SidePulse colors are decode-only."),
    }),
  ),
]).pipe(Schema.withDecodingDefault(Effect.succeed(null)));

const SidePulseColors = Schema.Struct({
  idle: colorSetting,
  done: colorSetting,
  working: colorSetting,
  attention: colorSetting,
});

export const SidePulseSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  brightness: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(100)),
  ),
  effects: SidePulseEffects.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  colors: SidePulseColors.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type SidePulseSettings = typeof SidePulseSettings.Type;

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
  /** The light the LEDs play for a few seconds after its effect or color changes. */
  preview: Schema.NullOr(SidePulseLedState),
});
export type SidePulseDeviceState = typeof SidePulseDeviceState.Type;

export interface DesktopSidePulseBridge {
  getState: () => Promise<SidePulseDeviceState>;
  onStateChange: (listener: (state: SidePulseDeviceState) => void) => () => void;
  /** Null when this window stops reporting thread state, which turns the LEDs off. */
  setLedState: (state: SidePulseLedState | null) => Promise<void>;
  /** Plays a light on the LEDs long enough to see its effect, then returns to the agent state. */
  preview: (light: SidePulseLedState) => Promise<void>;
}
