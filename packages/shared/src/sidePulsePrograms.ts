import type { SidePulseEffect, SidePulseLedState, SidePulseSettings } from "@supaterm/contracts";

export const SIDE_PULSE_LED_COUNT = 8;
export const SIDE_PULSE_OFF_PROGRAM = "off 1s";

// Each light's own color. Glow's brighter center is computed, except Idle's, which keeps SidePulse's cyan.
const LIGHTS: Readonly<
  Record<SidePulseLedState, { readonly color: string; readonly bright?: string }>
> = {
  idle: { color: "#006060", bright: "#00E5FF" },
  done: { color: "#00FF66" },
  working: { color: "#00E5FF" },
  attention: { color: "#FF3A00" },
};

const MULTICOLOR_EFFECTS: ReadonlySet<SidePulseEffect> = new Set(["rainbow", "spectrum"]);
const PREVIEW_MIN_MS = 3000;

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

// LEDS.LED programs and how long one loop takes. A pulse returns to its line's start color, so
// animations start from `off`.
const EFFECTS: Readonly<
  Record<
    SidePulseEffect,
    { readonly cycleMs: number; readonly program: (color: string, bright: string) => string }
  >
> = {
  solid: { cycleMs: 320, program: (color) => `${color} 320ms cosine` },
  breathe: { cycleMs: 4000, program: (color) => `off\n${color} 4s pulse\nrepeat` },
  pulse: { cycleMs: 1600, program: (color) => `off\n${color} 1.6s pulse\nrepeat` },
  heartbeat: {
    cycleMs: 1580,
    program: (color) => `off\n${color} 220ms pulse\n${color} 340ms pulse\noff 1s\nrepeat`,
  },
  glow: {
    cycleMs: 4000,
    program: (color, bright) =>
      `off 2s\n2:${color} 3:${bright} 4:${bright} 5:${color} 2s ease\nrepeat`,
  },
  roll: {
    cycleMs: 1745,
    program: (color) => `off 320ms cosine\n${pulses(color, 760, ROLL)}\nrepeat`,
  },
  ripple: {
    cycleMs: 1500,
    program: (color) => `off 320ms cosine\n${pulses(color, 760, RIPPLE)}\nrepeat`,
  },
  scanner: {
    cycleMs: 1680,
    program: (color) =>
      `off\n${pulses(color, 320, SWEEP_OUT)}\n${pulses(color, 320, SWEEP_BACK)}\nrepeat`,
  },
  twinkle: {
    cycleMs: 2410,
    program: (color) => `off 320ms cosine\n${pulses(color, 640, TWINKLE)}\nrepeat`,
  },
  rainbow: { cycleMs: 2000, program: () => `${RAINBOW.join(" ")}\nroll 2s linear\nrepeat` },
  spectrum: {
    cycleMs: 6000,
    program: () => `${RAINBOW.map((color) => `${color} 750ms cosine`).join("\n")}\nrepeat`,
  },
};

const toLinear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const fromLinear = (channel: number) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

function oklabToLinearRgb(lightness: number, a: number, b: number): ReadonlyArray<number> {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// The same hue 0.06 lighter in OKLCH, with as much of the color's chroma as sRGB allows there.
function brighterTone(hex: string): string {
  const [red, green, blue] = [1, 3, 5].map((offset) =>
    toLinear(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255),
  ) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const lightness = Math.min(1, 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s + 0.06);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const at = (scale: number) => oklabToLinearRgb(lightness, a * scale, b * scale);
  let low = 0;
  let high = 1;
  for (let step = 0; step < 30; step += 1) {
    const middle = (low + high) / 2;
    if (at(middle).every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4)) low = middle;
    else high = middle;
  }
  return `#${at(low)
    .map((channel) =>
      Math.round(255 * Math.min(1, Math.max(0, fromLinear(channel))))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** The color a light's single-color effects use: the user's pick, or the light's own. */
export function sidePulseLightColor(light: SidePulseLedState, settings: SidePulseSettings): string {
  return settings.colors[light] ?? LIGHTS[light].color;
}

/** Rainbow and Spectrum bring their own colors. */
export function sidePulseEffectUsesColor(effect: SidePulseEffect): boolean {
  return !MULTICOLOR_EFFECTS.has(effect);
}

/** Long enough to recognize an effect: 3 s, or one full loop of a slower one. */
export function sidePulsePreviewMs(effect: SidePulseEffect): number {
  return Math.max(PREVIEW_MIN_MS, EFFECTS[effect].cycleMs);
}

/** The LEDS.LED program for a state, or the fade to off when nothing reports state. */
export function sidePulseProgram(
  ledState: SidePulseLedState | null,
  settings: SidePulseSettings,
): string {
  if (ledState === null) return SIDE_PULSE_OFF_PROGRAM;
  const color = sidePulseLightColor(ledState, settings);
  const bright =
    settings.colors[ledState] === null
      ? (LIGHTS[ledState].bright ?? brighterTone(color))
      : brighterTone(color);
  const program = EFFECTS[settings.effects[ledState]].program(color, bright);
  const level = Math.round((settings.brightness / 100) * 255);
  return level >= 255 ? program : `brightness ${level}\n${program}`;
}
