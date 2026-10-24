import { describe, expect, it } from "vite-plus/test";

import { BoltComputerSim } from "./sim";

const advance = (sim: BoltComputerSim, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) sim.update(1 / 60);
};

describe("BoltComputerSim", () => {
  it("comes to rest so drawing can stop", () => {
    const sim = new BoltComputerSim(0.3);
    expect(sim.settled).toBe(false);
    advance(sim, 5);
    expect(sim.settled).toBe(true);
  });

  it("wakes for a click and rests again after the reaction", () => {
    const sim = new BoltComputerSim(0.3);
    advance(sim, 5);
    sim.poke();
    advance(sim, 0.5);
    expect(sim.sparkle).toBe(1);
    expect(sim.settled).toBe(false);
    advance(sim, 5);
    expect(sim.settled).toBe(true);
  });

  it("follows a nearby pointer and rests once it stops", () => {
    const sim = new BoltComputerSim(0.3);
    advance(sim, 5);
    const resting = sim.pose.yaw;
    sim.pointer = { x: 200, y: 0 };
    advance(sim, 0.1);
    expect(sim.settled).toBe(false);
    advance(sim, 5);
    expect(sim.settled).toBe(true);
    expect(sim.pose.yaw).toBeGreaterThan(resting);
  });

  it("leaves rest when a pointer arrives on a frame with no elapsed time", () => {
    const sim = new BoltComputerSim(0.3);
    advance(sim, 5);
    sim.pointer = { x: 200, y: 0 };
    sim.update(0);
    expect(sim.settled).toBe(false);
  });

  it("turns back once the pointer leaves", () => {
    const sim = new BoltComputerSim(0.3);
    advance(sim, 5);
    const resting = sim.pose.yaw;
    sim.pointer = { x: 200, y: 0 };
    advance(sim, 5);
    sim.pointer = null;
    sim.update(0);
    expect(sim.settled).toBe(false);
    advance(sim, 5);
    expect(sim.settled).toBe(true);
    expect(sim.pose.yaw).toBeCloseTo(resting, 2);
  });

  it("keeps animating while a state other than idle is shown", () => {
    const sim = new BoltComputerSim(0.3);
    advance(sim, 5);
    sim.setState("working");
    advance(sim, 10);
    expect(sim.settled).toBe(false);
    sim.setState("idle");
    advance(sim, 5);
    expect(sim.settled).toBe(true);
  });
});
