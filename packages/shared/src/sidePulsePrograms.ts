import type { SidePulseDevice, SidePulseLedState } from "@supaterm/contracts";

type LedCount = SidePulseDevice["ledCount"];

export const SIDE_PULSE_OFF_PROGRAM = "off 1s";

const cyanRoll = (ledCount: LedCount) => {
  const delayMs = ledCount === 2 ? 260 : 95;
  const segments = Array.from(
    { length: ledCount },
    (_, index) => `${index}:#00E5FF 760ms pulse ${index * delayMs}ms`,
  );
  return `off 320ms cosine\n${segments.join("; ")}\nrepeat`;
};

// The animations SidePulse's own agent monitor shows for each state.
const PROGRAMS: Readonly<Record<SidePulseLedState, Readonly<Record<LedCount, string>>>> = {
  idle: {
    2: "off 2s\n0:#006060 1:#006060 2s ease\nrepeat",
    8: "off 2s\n2:#006060 3:#00E5FF 4:#00E5FF 5:#006060 2s ease\nrepeat",
  },
  done: { 2: "#00FF66 320ms cosine", 8: "#00FF66 320ms cosine" },
  working: { 2: cyanRoll(2), 8: cyanRoll(8) },
  attention: { 2: "off\n#FF3A00 1.6s pulse\nrepeat", 8: "off\n#FF3A00 1.6s pulse\nrepeat" },
};

/** The LEDS.LED program for a state, or the fade to off when nothing reports state. */
export function sidePulseProgram(
  ledState: SidePulseLedState | null,
  ledCount: LedCount,
  brightness: number,
): string {
  if (ledState === null) return SIDE_PULSE_OFF_PROGRAM;
  const program = PROGRAMS[ledState][ledCount];
  const level = Math.round((brightness / 100) * 255);
  return level >= 255 ? program : `brightness ${level}\n${program}`;
}
