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
  it("parse on the firmware engine for every state and brightness", async () => {
    const engine = await instantiateSidePulseEngine(await compileEngine());
    for (const ledState of [...SIDE_PULSE_LED_STATES, null]) {
      for (const brightness of [100, 50, 0]) {
        const program = sidePulseProgram(ledState, brightness);
        expect(engine.play(program), program).toBe(true);
      }
    }
  });

  it("renders the program's colors at the chosen brightness", async () => {
    const engine = await instantiateSidePulseEngine(await compileEngine());
    engine.play(sidePulseProgram("done", 100));
    expect([...engine.step(1000)]).toEqual(Array.from({ length: 8 }, () => [0, 255, 102]).flat());
    engine.play(sidePulseProgram("done", 50));
    expect([...engine.step(1000)]).toEqual(Array.from({ length: 8 }, () => [0, 128, 51]).flat());
    engine.play(sidePulseProgram(null, 100));
    expect([...engine.step(1000)]).toEqual(Array(24).fill(0));
  });
});
