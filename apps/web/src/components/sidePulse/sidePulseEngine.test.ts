import {
  SIDE_PULSE_EFFECTS,
  SIDE_PULSE_LED_STATES,
  type SidePulseColor,
  type SidePulseEffect,
} from "@supaterm/contracts";
import { sidePulseEffectUsesColor, sidePulseProgram } from "@supaterm/shared/sidePulsePrograms";
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

function settings(
  brightness: number,
  effect: SidePulseEffect,
  color: SidePulseColor | null = null,
) {
  return {
    enabled: true,
    brightness,
    effects: { idle: effect, done: effect, working: effect, attention: effect },
    colors: { idle: color, done: color, working: color, attention: color },
  };
}

describe("SidePulse LED programs", () => {
  it("parse on the firmware engine for every effect, state, and brightness", async () => {
    const engine = await instantiateSidePulseEngine(await compileEngine());
    for (const effect of SIDE_PULSE_EFFECTS) {
      for (const ledState of [...SIDE_PULSE_LED_STATES, null]) {
        for (const brightness of [100, 50, 0]) {
          for (const color of [null, "#123456", "#FFFFFF"]) {
            const program = sidePulseProgram(ledState, settings(brightness, effect, color));
            expect(engine.play(program), program).toBe(true);
          }
        }
      }
    }
  });

  it("gives each light its own program for every effect that keeps the light's color", () => {
    for (const effect of SIDE_PULSE_EFFECTS.filter(sidePulseEffectUsesColor)) {
      const programs = SIDE_PULSE_LED_STATES.map((ledState) =>
        sidePulseProgram(ledState, settings(100, effect)),
      );
      expect(new Set(programs).size, effect).toBe(SIDE_PULSE_LED_STATES.length);
    }
  });

  it("draws a light's effects in its custom color, except the multicolor ones", () => {
    expect(sidePulseProgram("working", settings(100, "solid", "#FF00AA"))).toBe(
      "#FF00AA 320ms cosine",
    );
    expect(sidePulseProgram("working", settings(100, "rainbow", "#FF00AA"))).toBe(
      sidePulseProgram("working", settings(100, "rainbow")),
    );
  });

  it("renders the program's colors at the chosen brightness", async () => {
    const engine = await instantiateSidePulseEngine(await compileEngine());
    engine.play(sidePulseProgram("done", settings(100, "solid")));
    expect([...engine.step(1000)]).toEqual(Array.from({ length: 8 }, () => [0, 255, 102]).flat());
    engine.play(sidePulseProgram("done", settings(50, "solid")));
    expect([...engine.step(1000)]).toEqual(Array.from({ length: 8 }, () => [0, 128, 51]).flat());
    engine.play(sidePulseProgram(null, settings(100, "solid")));
    expect([...engine.step(1000)]).toEqual(Array(24).fill(0));
  });
});
