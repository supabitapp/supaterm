import type { SidePulseEffect, SidePulseLedState, SidePulseSettings } from "@supaterm/contracts";

export const SIDE_PULSE_LED_COUNT = 8;
export const SIDE_PULSE_OFF_PROGRAM = "off 1s";

// Each light's color and Glow's brighter center. Idle's pair is SidePulse's own dim teal and cyan;
// the others are the same hue 0.06 lighter in OKLCH, at the most chroma sRGB allows there.
const STATE_COLORS: Readonly<Record<SidePulseLedState, { color: string; bright: string }>> = {
  idle: { color: "#006060", bright: "#00E5FF" },
  done: { color: "#00FF66", bright: "#B1FFBA" },
  working: { color: "#00E5FF", bright: "#97F0FF" },
  attention: { color: "#FF3A00", bright: "#FF6E4F" },
};

// Eight OKLCH hues 45° apart from 20°, each at the most vivid color sRGB can show.
const RAINBOW = [
  "#FF0044",
  "#FF9A00",
  "#FEFF00",
  "#00FF95",
  "#00F5FF",
  "#00A3FF",
  "#7400FF",
  "#FF00E2",
];

type Timeline = ReadonlyArray<readonly [led: number, delayMs: number]>;

const LEDS = Array.from({ length: SIDE_PULSE_LED_COUNT }, (_, led) => led);
const ROLL: Timeline = LEDS.map((led) => [led, led * 95]);
const SWEEP_OUT: Timeline = LEDS.map((led) => [led, led * 85]);
const SWEEP_BACK: Timeline = [6, 5, 4, 3, 2, 1].map((led, step) => [led, step * 85]);
const RIPPLE: Timeline = [
  [3, 0],
  [4, 0],
  [2, 140],
  [5, 140],
  [1, 280],
  [6, 280],
  [0, 420],
  [7, 420],
];
const TWINKLE: Timeline = [
  [5, 0],
  [1, 230],
  [6, 470],
  [2, 610],
  [7, 880],
  [3, 1040],
  [0, 1300],
  [4, 1450],
];

function pulses(color: string, durationMs: number, timeline: Timeline): string {
  return timeline
    .map(([led, delayMs]) => `${led}:${color} ${durationMs}ms pulse ${delayMs}ms`)
    .join("; ");
}

// LEDS.LED programs. A pulse returns to its line's start color, so animations start from `off`.
const EFFECTS: Readonly<Record<SidePulseEffect, (color: string, bright: string) => string>> = {
  solid: (color) => `${color} 320ms cosine`,
  breathe: (color) => `off\n${color} 4s pulse\nrepeat`,
  pulse: (color) => `off\n${color} 1.6s pulse\nrepeat`,
  heartbeat: (color) => `off\n${color} 220ms pulse\n${color} 340ms pulse\noff 1s\nrepeat`,
  glow: (color, bright) => `off 2s\n2:${color} 3:${bright} 4:${bright} 5:${color} 2s ease\nrepeat`,
  roll: (color) => `off 320ms cosine\n${pulses(color, 760, ROLL)}\nrepeat`,
  ripple: (color) => `off 320ms cosine\n${pulses(color, 760, RIPPLE)}\nrepeat`,
  scanner: (color) =>
    `off\n${pulses(color, 320, SWEEP_OUT)}\n${pulses(color, 320, SWEEP_BACK)}\nrepeat`,
  twinkle: (color) => `off 320ms cosine\n${pulses(color, 640, TWINKLE)}\nrepeat`,
  rainbow: () => `${RAINBOW.join(" ")}\nroll 2s linear\nrepeat`,
  spectrum: () => `${RAINBOW.map((color) => `${color} 750ms cosine`).join("\n")}\nrepeat`,
};

/** The LEDS.LED program for a state, or the fade to off when nothing reports state. */
export function sidePulseProgram(
  ledState: SidePulseLedState | null,
  settings: SidePulseSettings,
): string {
  if (ledState === null) return SIDE_PULSE_OFF_PROGRAM;
  const { color, bright } = STATE_COLORS[ledState];
  const program = EFFECTS[settings.effects[ledState]](color, bright);
  const level = Math.round((settings.brightness / 100) * 255);
  return level >= 255 ? program : `brightness ${level}\n${program}`;
}
