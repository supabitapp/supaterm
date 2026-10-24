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
const REACTION = 1.6;
const FADE = 0.3;
const GLITCH = 0.13;
export const POINTER_REACH = 700;

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

/** Where the computer rests, turned a little toward the reader; also the still pose for reduced motion. */
export const REST_POSE: Pose = { yaw: -0.18, pitch: 0.04, roll: 0.03, lift: 0, sx: 1, sy: 1 };

/**
 * Motion for the bolt computer. Springs chase a resting angle or a nearby
 * pointer, a click's hop is scripted on top, and it comes to rest so the frame
 * loop can stop.
 */
export class BoltComputerSim {
  /** Seconds since it switched on. */
  age = 0;
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

  constructor(seed: number) {
    this.random = rng(seed);
  }

  /** A click: a hop with a full turn, and sparkles round the bolt. */
  poke() {
    this.hop(0.1, this.random() < 0.5 ? 1 : -1);
    this.reactedAt = this.age;
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

  /** The screen tears briefly as the sparkles start and end. */
  get glitching() {
    const t = this.reaction;
    return t < GLITCH || (t >= REACTION && t < REACTION + GLITCH);
  }

  get settled(): boolean {
    return (
      this.jump === null &&
      this.age > POWER_ON &&
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

    let { yaw, pitch, roll } = REST_POSE;
    if (this.pointer) {
      yaw = clamp(this.pointer.x / 260, -1, 1) * 0.55;
      pitch = -clamp(this.pointer.y / 260, -1, 1) * 0.32;
      roll = -yaw * 0.12;
    }
    this.yaw.step(yaw, dt, 1.3, 0.62);
    this.pitch.step(pitch, dt, 1.3, 0.62);
    this.roll.step(roll, dt, 1.3, 0.62);

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
      yaw: this.yaw.x + spin,
      pitch: this.pitch.x,
      roll: this.roll.x + lean,
      lift,
      sx: 1 + sq * 0.55,
      sy: 1 - sq,
    };
  }
}
