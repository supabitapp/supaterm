import type { BoltComputerState } from "./faces";

class Spring {
  x = 0;
  v = 0;
  target = 0;
  step(target: number, dt: number, freq: number, damping: number) {
    const w = freq * Math.PI * 2;
    this.target = target;
    this.v += (w * w * (target - this.x) - 2 * damping * w * this.v) * dt;
    this.x += this.v * dt;
  }
  get resting() {
    return Math.abs(this.x - this.target) < 1e-3 && Math.abs(this.v) < 1e-3;
  }
}

function rng(seed: number) {
  let a = Math.floor(seed * 4294967295) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

interface Jump {
  age: number;
  readonly height: number;
  readonly spin: number;
  readonly lean: number;
  readonly air: number;
  landed: boolean;
}

const CROUCH = 0.11;
export const POWER_ON = 0.55;
export const FADE = 0.3;
const REACTION = 1.6;
const GLITCH = 0.13;
export const POINTER_REACH = 700;
export const ERROR_SHAKE_PERIOD = 2.4;

export interface Pose {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  /** Upward, in head units. */
  readonly lift: number;
  /** Scale about the bottom of the housing. */
  readonly sx: number;
  readonly sy: number;
}

/** The still pose of each state, for paused and reduced-motion drawing and as idle's resting angle. */
export function restPose(state: BoltComputerState): Pose {
  const base = { yaw: 0, pitch: 0, roll: 0, lift: 0, sx: 1, sy: 1 };
  switch (state) {
    case "idle":
      return { ...base, yaw: -0.18, pitch: 0.04, roll: 0.03 };
    case "thinking":
      return { ...base, yaw: 0.24, pitch: 0.17, roll: -0.13 };
    case "working":
      return { ...base, pitch: -0.16 };
    case "error":
      return { ...base, pitch: -0.06, roll: -0.05 };
  }
}

/**
 * Motion for the bolt computer. Each state sets targets that springs chase,
 * hops are scripted on top, and idle comes to rest so the frame loop can stop.
 */
export class BoltComputerSim {
  state: BoltComputerState;
  /** The state before the last switch, null until there has been one. */
  previous: BoltComputerState | null = null;
  /** Seconds since it switched on, and since the state last changed. */
  age = 0;
  since = 0;
  /** How long the previous state had been showing when it changed. */
  private previousSince = 0;
  pose: Pose = { yaw: 0, pitch: 0, roll: 0, lift: 0, sx: 1, sy: 1 };
  /** The pointer relative to the housing's centre in CSS px, or null when away. */
  pointer: { readonly x: number; readonly y: number } | null = null;

  private readonly yaw = new Spring();
  private readonly pitch = new Spring();
  private readonly roll = new Spring();
  private readonly squash = new Spring();
  private jump: Jump | null = null;
  private readonly random: () => number;
  private reactedAt = Number.NEGATIVE_INFINITY;
  private side = 1;
  private nextSide = 4;
  private nextHop = 6;

  constructor(seed: number, state: BoltComputerState = "idle") {
    this.random = rng(seed);
    this.state = state;
  }

  setState(state: BoltComputerState) {
    if (state === this.state) return;
    this.previous = this.state;
    this.previousSince = this.since;
    this.state = state;
    this.since = 0;
    this.nextHop = this.age + 3 + this.random() * 4;
  }

  /** Drop the fade from the last state change, for one made while nothing was drawing. */
  skipFade() {
    this.previous = null;
  }

  /** A click: a hop with a full turn, and sparkles round the bolt. */
  poke() {
    this.hop(0.1, this.random() < 0.5 ? 1 : -1);
    this.reactedAt = this.age;
  }

  /** The previous state's clock, still running while its face fades out. */
  get previousTime() {
    return this.previousSince + this.since;
  }

  /** Seconds since the last click. */
  get reaction() {
    return this.age - this.reactedAt;
  }

  /** How strongly the click's sparkles show, fading in and out. */
  get sparkle() {
    const t = this.reaction;
    return Math.max(0, Math.min(1, t / FADE, (REACTION + FADE - t) / FADE));
  }

  /** The screen tears briefly as the state changes and as the sparkles start and end. */
  get glitching() {
    const t = this.reaction;
    const switching = this.previous !== null && this.since < GLITCH;
    return switching || t < GLITCH || (t >= REACTION && t < REACTION + GLITCH);
  }

  get settled(): boolean {
    return (
      this.state === "idle" &&
      this.jump === null &&
      this.age > POWER_ON &&
      this.since > FADE &&
      this.reaction > REACTION + FADE &&
      this.yaw.resting &&
      this.pitch.resting &&
      this.roll.resting &&
      this.squash.resting
    );
  }

  update(dt: number) {
    // A zero-length step still aims the springs, so a wake whose first frame
    // has no elapsed time is not mistaken for rest.
    if (!(dt >= 0)) return;
    // Small steps keep the springs stable on a slow frame.
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps; i++) this.step(dt / steps);
  }

  private hop(height: number, spin: number) {
    if (this.jump) return;
    this.jump = {
      age: 0,
      height,
      spin,
      lean: (this.random() - 0.5) * 0.3,
      air: 0.42 + height * 0.45,
      landed: false,
    };
  }

  private step(dt: number) {
    this.age += dt;
    this.since += dt;
    const t = this.age;

    let { yaw, pitch, roll } = restPose(this.state);
    let bob = 0;
    let freq = 1.3;
    let shake = 0;
    switch (this.state) {
      case "idle":
        if (this.pointer) {
          yaw = clamp(this.pointer.x / 260, -1, 1) * 0.55;
          pitch = -clamp(this.pointer.y / 260, -1, 1) * 0.32;
          roll = -yaw * 0.12;
        }
        break;
      case "thinking":
        if (t > this.nextSide) {
          this.side = -this.side;
          this.nextSide = t + 3 + this.random() * 2;
        }
        yaw = 0.24 * this.side + Math.sin(t * 0.9) * 0.05;
        pitch = 0.17 + Math.sin(t * 1.3) * 0.03;
        roll = -0.13 * this.side;
        bob = Math.sin(t * 1.9) * 0.008;
        freq = 0.9;
        break;
      case "working":
        yaw = Math.sin(t * 0.8) * 0.08;
        roll = Math.sin(t * 0.5) * 0.04;
        bob = Math.abs(Math.sin(t * 7)) * 0.012;
        if (t > this.nextHop) {
          this.hop(0.1, 0);
          this.nextHop = t + 5 + this.random() * 3;
        }
        break;
      case "error": {
        const c = (t % ERROR_SHAKE_PERIOD) / 0.7;
        shake = c < 1 ? Math.sin(c * Math.PI * 7) * 0.22 * (1 - c) : 0;
        freq = 1.6;
        break;
      }
    }
    this.yaw.step(yaw, dt, freq, 0.62);
    this.pitch.step(pitch, dt, freq, 0.62);
    this.roll.step(roll, dt, freq, 0.62);

    let lift = 0;
    let spin = 0;
    let lean = 0;
    let squash = 0;
    const j = this.jump;
    if (j) {
      j.age += dt;
      if (j.age < CROUCH) {
        squash = 0.14;
      } else {
        const ap = (j.age - CROUCH) / j.air;
        if (ap < 1) {
          // Leaving the ground springs up into a stretch.
          if (ap < 0.06 && this.squash.x > 0.05) this.squash.v = -1.8;
          lift = 4 * j.height * ap * (1 - ap);
          spin = j.spin * Math.PI * 2 * easeInOut(clamp(ap * 1.08, 0, 1));
          lean = j.lean * Math.sin(ap * Math.PI);
          squash = ap < 0.5 ? -0.05 : 0;
        } else if (!j.landed) {
          j.landed = true;
          this.squash.v += 3.2;
        } else if (j.age - CROUCH - j.air > 0.35) {
          this.jump = null;
        }
      }
    }
    this.squash.step(squash, dt, 3.2, 0.32);

    const sq = this.squash.x;
    this.pose = {
      yaw: this.yaw.x + spin + shake,
      pitch: this.pitch.x,
      roll: this.roll.x + lean,
      lift: lift + bob,
      sx: 1 + sq * 0.55,
      sy: 1 - sq,
    };
  }
}
