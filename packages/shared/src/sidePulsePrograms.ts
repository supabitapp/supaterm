import type { SidePulseEffect, SidePulseLedState, SidePulseSettings } from "@supaterm/contracts";

export const SIDE_PULSE_LED_COUNT = 8;
export const SIDE_PULSE_OFF_PROGRAM = "off 1s";

// Each state's color and its soft companion: the same hue at about half the OKLCH lightness and chroma.
const STATE_COLORS: Readonly<Record<SidePulseLedState, { color: string; soft: string }>> = {
  idle: { color: "#00E5FF", soft: "#006060" },
  done: { color: "#00FF66", soft: "#006A27" },
  working: { color: "#00E5FF", soft: "#006060" },
  attention: { color: "#FF3A00", soft: "#6A1300" },
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

const ROLL: Timeline = Array.from({ length: SIDE_PULSE_LED_COUNT }, (_, led) => [led, led * 95]);
const SWEEP_OUT: Timeline = Array.from({ length: SIDE_PULSE_LED_COUNT }, (_, led) => [
  led,
  led * 85,
]);
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
const EFFECTS: Readonly<Record<SidePulseEffect, (color: string, soft: string) => string>> = {
  solid: (color) => `${color} 320ms cosine`,
  breathe: (color) => `off\n${color} 4s pulse\nrepeat`,
  pulse: (color) => `off\n${color} 1.6s pulse\nrepeat`,
  heartbeat: (color, soft) => `off\n${color} 220ms pulse\n${soft} 340ms pulse\noff 1s\nrepeat`,
  glow: (color, soft) => `off 2s\n2:${soft} 3:${color} 4:${color} 5:${soft} 2s ease\nrepeat`,
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
  const { color, soft } = STATE_COLORS[ledState];
  const program = EFFECTS[settings.effects[ledState]](color, soft);
  const level = Math.round((settings.brightness / 100) * 255);
  return level >= 255 ? program : `brightness ${level}\n${program}`;
}
