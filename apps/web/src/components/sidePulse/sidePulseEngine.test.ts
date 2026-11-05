import { SIDE_PULSE_LED_STATES } from "@supaterm/contracts";
import { sidePulseProgram } from "@supaterm/shared/sidePulsePrograms";
import { describe, expect, it } from "vite-plus/test";

import { instantiateSidePulseEngine } from "./sidePulseEngine";
import sdledWasmDataUrl from "./vendor/sdled.wasm?inline";

function compileEngine() {
  const encoded = sdledWasmDataUrl.split(",", 2)[1];
  if (!encoded) throw new Error("The vendored SidePulse WASM data URL is invalid");
  return WebAssembly.compile(
    Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
  );
}

describe("SidePulse LED programs", () => {
  it("parse on the firmware engine for every state, device, and brightness", async () => {
    const module = await compileEngine();
    for (const ledCount of [2, 8] as const) {
      const engine = await instantiateSidePulseEngine(module, ledCount);
      for (const ledState of [...SIDE_PULSE_LED_STATES, null]) {
        for (const brightness of [100, 50, 0]) {
          const program = sidePulseProgram(ledState, ledCount, brightness);
          expect(engine.play(program), program).toBe(true);
        }
      }
    }
  });

  it("renders the program's colors at the chosen brightness", async () => {
    const engine = await instantiateSidePulseEngine(await compileEngine(), 2);
    engine.play(sidePulseProgram("done", 2, 100));
    expect([...engine.step(1000)]).toEqual([0, 255, 102, 0, 255, 102]);
    engine.play(sidePulseProgram("done", 2, 50));
    expect([...engine.step(1000)]).toEqual([0, 128, 51, 0, 128, 51]);
    engine.play(sidePulseProgram(null, 2, 100));
    expect([...engine.step(1000)]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
