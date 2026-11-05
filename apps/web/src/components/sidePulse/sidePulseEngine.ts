import { SIDE_PULSE_LED_COUNT } from "@supaterm/shared/sidePulsePrograms";

import sdledWasmUrl from "./vendor/sdled.wasm?url";

const INPUT_BYTES = 512;

interface SdledExports {
  readonly memory: WebAssembly.Memory;
  readonly sdled_input_ptr: () => number;
  readonly sdled_output_ptr: () => number;
  readonly sdled_reset: (ledCount: number, nowMs: number) => void;
  readonly sdled_parse: (ledCount: number, length: number, nowMs: number) => number;
  readonly sdled_step: (ledCount: number, nowMs: number) => void;
}

const SDLED_FUNCTIONS = [
  "sdled_input_ptr",
  "sdled_output_ptr",
  "sdled_reset",
  "sdled_parse",
  "sdled_step",
] as const;

function isSdledExports(
  exports: WebAssembly.Exports,
): exports is WebAssembly.Exports & SdledExports {
  return (
    exports.memory instanceof WebAssembly.Memory &&
    SDLED_FUNCTIONS.every((name) => typeof exports[name] === "function")
  );
}

/** SidePulse's firmware LED engine: it parses a LEDS.LED program and renders its frames. */
export interface SidePulseEngine {
  /** Starts a program from all LEDs off, as a fresh device would; false when it does not parse. */
  readonly play: (program: string) => boolean;
  /** RGB bytes for every LED, `nowMs` after the program started. */
  readonly step: (nowMs: number) => Uint8Array;
}

export async function instantiateSidePulseEngine(
  module: WebAssembly.Module,
): Promise<SidePulseEngine> {
  const { exports } = await WebAssembly.instantiate(module, {});
  if (!isSdledExports(exports)) throw new Error("The SidePulse LED engine has unexpected exports");
  const encoder = new TextEncoder();
  return {
    play: (program) => {
      exports.sdled_reset(SIDE_PULSE_LED_COUNT, 0);
      const bytes = encoder.encode(program);
      const input = new Uint8Array(exports.memory.buffer, exports.sdled_input_ptr(), INPUT_BYTES);
      input.fill(0);
      input.set(bytes.subarray(0, INPUT_BYTES));
      // The engine rejects anything past its input buffer as too long.
      const length = bytes.length > INPUT_BYTES ? INPUT_BYTES + 1 : bytes.length;
      return (exports.sdled_parse(SIDE_PULSE_LED_COUNT, length, 0) & 1) === 1;
    },
    step: (nowMs) => {
      exports.sdled_step(SIDE_PULSE_LED_COUNT, Math.floor(nowMs));
      return new Uint8Array(
        exports.memory.buffer,
        exports.sdled_output_ptr(),
        SIDE_PULSE_LED_COUNT * 3,
      );
    },
  };
}

let compiled: Promise<WebAssembly.Module> | null = null;

export function createSidePulseEngine(): Promise<SidePulseEngine> {
  compiled ??= fetch(sdledWasmUrl)
    .then((response) => {
      if (!response.ok)
        throw new Error(`Could not load the SidePulse LED engine: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.compile(bytes))
    .catch((error: unknown) => {
      compiled = null;
      throw error;
    });
  return compiled.then((module) => instantiateSidePulseEngine(module));
}
