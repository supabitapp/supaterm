import type { SidePulseLedState } from "@supaterm/contracts";

export const SIDE_PULSE_LED_COUNT = 8;
export const SIDE_PULSE_OFF_PROGRAM = "off 1s";

const cyanRoll = Array.from(
  { length: SIDE_PULSE_LED_COUNT },
  (_, index) => `${index}:#00E5FF 760ms pulse ${index * 95}ms`,
).join("; ");

// The animations SidePulse's own agent monitor shows for each state.
const PROGRAMS: Readonly<Record<SidePulseLedState, string>> = {
  idle: "off 2s\n2:#006060 3:#00E5FF 4:#00E5FF 5:#006060 2s ease\nrepeat",
  done: "#00FF66 320ms cosine",
  working: `off 320ms cosine\n${cyanRoll}\nrepeat`,
  attention: "off\n#FF3A00 1.6s pulse\nrepeat",
};

/** The LEDS.LED program for a state, or the fade to off when nothing reports state. */
export function sidePulseProgram(ledState: SidePulseLedState | null, brightness: number): string {
  if (ledState === null) return SIDE_PULSE_OFF_PROGRAM;
  const program = PROGRAMS[ledState];
  const level = Math.round((brightness / 100) * 255);
  return level >= 255 ? program : `brightness ${level}\n${program}`;
}
