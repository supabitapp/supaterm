const TAU = Math.PI * 2;
const STEP = 1 / 240;
const HISTORY = 512;
const SAMPLES_PER_COLUMN = 3;
const SPEEDS = [0.8, 1.25, 1.85, 2.6] as const;
const BASE = [0.55, 0.42, 0.3, 0.2] as const;
const SPATIAL = [1.4, 2.4, 3.8, 5.6] as const;
const ENTER = 0.42;
const PHOSPHOR_HEAD = 0.15;
const PHOSPHOR_TAIL = 0.6;
const BREATH_PERIOD = 5.5;
const CARRIER_REST = 0.14;
const HELIX_CYCLES = 1.6;
const RESPONSE_HZ = 6.5;
const RELEASE = 0.15;
const HISTORY_SPEED = 150;
const AUTO_RELEASE = 3;
const NOISE_FLOOR = -60;

const DOT_SCOPE_COLUMNS = 33;
const DOT_SCOPE_ROWS = 9;
const DOT_SCOPE_PITCH = 2.6;
export const DOT_SCOPE_WIDTH = 90;
export const DOT_SCOPE_HEIGHT = 26;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const bump = (d: number, w: number) => Math.exp(-((d / w) * (d / w)));

const follow = (value: number, target: number, time: number, h: number) =>
  value + (target - value) * (1 - Math.exp(-h / time));

export function loudnessOf(rms: number): number {
  return 20 * Math.log10(Math.max(0, rms) + 1e-6);
}

const AUTO_MIN_SPAN = 16;
const AUTO_RANGE = 24;
const AUTO_ROOM_MARGIN = 5;
const AUTO_ATTACK = 0.04;
const ROOM_FALL = 0.3;
const ROOM_RISE = 6;

/**
 * The speaker's recent peak reads as full and the room as silent, so a quiet microphone moves the
 * scope as far as a loud one; the peak stays 16 dB above the room so silence is never boosted.
 */
export class AutoLevel {
  peak = -30;
  room = -55;

  step(loudness: number, h: number): number {
    const db = Math.max(loudness, -120);
    this.room = follow(this.room, db, db < this.room ? ROOM_FALL : ROOM_RISE, h);
    const lowest = Math.max(this.room, NOISE_FLOOR) + AUTO_MIN_SPAN;
    this.peak =
      db > this.peak
        ? follow(this.peak, db, AUTO_ATTACK, h)
        : follow(this.peak, lowest, AUTO_RELEASE, h);
    this.peak = Math.max(this.peak, lowest);
    const low = Math.max(
      Math.max(this.room, NOISE_FLOOR) + AUTO_ROOM_MARGIN,
      this.peak - AUTO_RANGE,
    );
    return Math.min(1, Math.max(0, (db - low) / Math.max(1, this.peak - low)));
  }
}

class Voice {
  level = 0;
  private reservoir = 0;
  energy = 0;
  band = 0;

  step(raw: number, h: number): void {
    this.level = follow(this.level, raw, raw > this.level ? 0.035 : 0.095, h);
    this.reservoir += (1.75 * this.level * this.level - this.reservoir / 1.8) * h;
    this.energy = 1 - Math.exp(-this.reservoir * 1.45);
    this.band = follow(this.band, raw, raw > this.band ? 0.025 : 0.14, h);
  }
}

class Trace {
  private envelope = 0;
  private amplitude = 0;
  private amplitudeVelocity = 0;
  private readonly history = new Float32Array(HISTORY * 5);
  private head = 0;

  constructor(readonly phases: Array<number>) {}

  tick(voice: Voice, live: number, speed: number, h: number): void {
    this.envelope = follow(
      this.envelope,
      voice.level,
      voice.level > this.envelope ? 0.022 : RELEASE,
      h,
    );
    const w = TAU * RESPONSE_HZ;
    this.amplitudeVelocity +=
      (-w * w * (this.amplitude - this.envelope) - 2 * 0.52 * w * this.amplitudeVelocity) * h;
    this.amplitude += this.amplitudeVelocity * h;
    const go = 0.6 + 1.1 * Math.min(1, this.envelope * 1.6);
    for (let c = 0; c < 4; c++) {
      this.phases[c] = (this.phases[c]! + h * TAU * SPEEDS[c]! * go * speed) % TAU;
    }
    const emphasis = 0.35 + 0.65 * Math.min(2, voice.band / (voice.band + 0.06));
    const offset = this.head * 5;
    const amplitude = Math.max(0, this.amplitude) * live;
    this.history[offset] = amplitude;
    for (let c = 0; c < 4; c++) this.history[offset + 1 + c] = amplitude * BASE[c]! * emphasis;
    this.head = (this.head + 1) % HISTORY;
  }

  past(delay: number, channel: number): number {
    const d = Math.min(delay / STEP, HISTORY - 2);
    const i = Math.floor(d);
    const k = d - i;
    const a = (this.head + 2 * HISTORY - 1 - i) % HISTORY;
    const b = (a + HISTORY - 1) % HISTORY;
    return this.history[a * 5 + channel]! * (1 - k) + this.history[b * 5 + channel]! * k;
  }
}

/**
 * A field of dots lit by a braided pair of oscilloscope traces that follow the voice, stepped at a
 * fixed 240 Hz so every frame rate draws the same picture. `still` holds the braid for reduced motion.
 */
export class DotScope {
  readonly columns = DOT_SCOPE_COLUMNS;
  readonly rows = DOT_SCOPE_ROWS;
  /** Each dot's (brightness, freshness), row by row. */
  readonly dots = new Float32Array(DOT_SCOPE_COLUMNS * DOT_SCOPE_ROWS * 2);
  live = 0;
  grid = 0;
  private readonly auto = new AutoLevel();
  private readonly voices = [new Voice(), new Voice()] as const;
  private readonly traces = [
    new Trace([0.1, 1.7, 3.3, 4.6]),
    new Trace([2.4, 0.6, 5.1, 1.9]),
  ] as const;
  private readonly samples = (DOT_SCOPE_COLUMNS - 1) * SAMPLES_PER_COLUMN + 1;
  private readonly ys = [new Float32Array(this.samples), new Float32Array(this.samples)] as const;
  private readonly brightness = [
    new Float32Array(this.samples),
    new Float32Array(this.samples),
  ] as const;
  private readonly heads = [
    new Float32Array(DOT_SCOPE_COLUMNS * DOT_SCOPE_ROWS),
    new Float32Array(DOT_SCOPE_COLUMNS * DOT_SCOPE_ROWS),
  ] as const;
  private readonly tails = [
    new Float32Array(DOT_SCOPE_COLUMNS * DOT_SCOPE_ROWS),
    new Float32Array(DOT_SCOPE_COLUMNS * DOT_SCOPE_ROWS),
  ] as const;
  private carrier = 0;
  private time = 0;
  private steps = 0;
  private pending = 0;

  constructor(private readonly still: boolean) {}

  /** Advances `dt` seconds while the microphone reads `loudness` dBFS. */
  advance(dt: number, loudness: number): void {
    this.pending += Math.min(0.25, Math.max(0, dt));
    while (this.pending >= STEP) {
      this.pending -= STEP;
      this.step(loudness);
    }
  }

  private step(loudness: number): void {
    const h = STEP;
    const level = this.auto.step(loudness, h);
    this.voices[0].step(level, h);
    this.voices[1].step(level * 0.85, h);
    this.live = follow(this.live, 1, 0.55, h);
    const speed = this.still ? 0 : 1;
    this.traces[0].tick(this.voices[0], this.live, speed, h);
    this.traces[1].tick(this.voices[1], this.live, speed, h);
    const energy = Math.max(this.voices[0].energy, this.voices[1].energy);
    this.carrier = (this.carrier + h * TAU * (CARRIER_REST + 0.22 * energy) * speed) % TAU;
    this.time += h;
    this.steps += 1;
    if (this.steps % 2 === 0) this.beam(2 * h);
  }

  private beam(hb: number): void {
    const { columns, rows, samples } = this;
    const sub = SAMPLES_PER_COLUMN;
    const width = DOT_SCOPE_WIDTH;
    const halfWidth = width / 2;
    const e = this.time;
    this.grid = this.still ? 1 : Math.min(1, e / 0.3);
    const reach = this.still
      ? 1e4
      : (halfWidth + 12) * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, e / ENTER)));
    const scanner = this.still ? 0 : 2.8 * (1 - smoothstep(0.08, ENTER, e));
    const unfold = this.still ? 1 : smoothstep(0, 0.1, e);
    const mid = (rows - 1) / 2;
    const half = mid - 0.55;
    const breath = this.still ? 0.5 : 0.5 + 0.5 * Math.sin((this.time * TAU) / BREATH_PERIOD);
    const rest = (0.55 + 0.35 * breath) * (0.4 + 0.6 * this.live);
    for (let k = 0; k < 2; k++) {
      const trace = this.traces[k]!;
      const sign = k === 0 ? 1 : -1;
      const ys = this.ys[k]!;
      const brightness = this.brightness[k]!;
      for (let s = 0; s < samples; s++) {
        const x = (s / sub - (columns - 1) / 2) * DOT_SCOPE_PITCH;
        const own = Math.abs(x);
        if (own > halfWidth) {
          ys[s] = mid;
          brightness[s] = 0;
          continue;
        }
        const drawn =
          unfold * (1 - smoothstep(Math.max(0, reach - 14), Math.max(0.001, reach), own));
        const amplitude =
          drawn * (1 - smoothstep(Math.max(0, reach - 22), Math.max(0.001, reach - 3), own));
        const bright = amplitude + scanner * bump(own - reach, 6);
        const swell = 1.8 * unfold * (scanner / 2.8) * bump(own - Math.max(0, reach - 14), 14);
        const xn = (x + halfWidth) / width;
        const ends = Math.min(
          smoothstep(-halfWidth + 3, -halfWidth + 17, x),
          smoothstep(-halfWidth + 3, -halfWidth + 17, -x),
        );
        const fade = 1 - 0.8 * smoothstep(14, halfWidth, own);
        const delay = own / HISTORY_SPEED;
        const a = trace.past(delay, 0);
        let spread = 0;
        for (let c = 0; c < 4; c++) {
          spread += trace.past(delay, 1 + c) * Math.sin(TAU * SPATIAL[c]! * xn - trace.phases[c]!);
        }
        const helix =
          (rest + swell + half * 0.55 * a * fade) *
          Math.sin(TAU * HELIX_CYCLES * xn - this.carrier);
        const y = half * Math.tanh((helix + half * 0.7 * spread * fade) / half) * ends * amplitude;
        ys[s] = mid - sign * y;
        const spatial = (0.3 + 0.7 * Math.min(1, a * 1.8)) * (0.45 + 0.55 * ends);
        brightness[s] = spatial * amplitude + 0.36 * Math.max(0, bright - amplitude);
      }
      for (let s = 0; s < samples; s++) {
        const slope = ((ys[Math.min(s + 1, samples - 1)]! - ys[Math.max(0, s - 1)]!) * sub) / 2;
        brightness[s]! *= 0.45 + 0.55 / Math.sqrt(1 + 0.22 * slope * slope);
      }
    }

    const headKeep = Math.exp(-hb / PHOSPHOR_HEAD);
    const tailKeep = Math.exp(-hb / PHOSPHOR_TAIL);
    const dx = 1 / sub;
    for (let i = 0; i < columns; i++) {
      const s0 = Math.max(0, i - 3) * sub;
      const s1 = Math.min((i + 3) * sub, samples - 1);
      for (let j = 0; j < rows; j++) {
        const n = j * columns + i;
        let now = 0;
        let total = 0;
        let dark = 1;
        for (let k = 0; k < 2; k++) {
          const ys = this.ys[k]!;
          let best = Number.MAX_VALUE;
          let nearest = i * sub;
          for (let s = s0; s < s1; s++) {
            const ay = ys[s]!;
            const dy = ys[s + 1]! - ay;
            const px = i - s * dx;
            const py = j - ay;
            const t = Math.min(1, Math.max(0, (px * dx + py * dy) / (dx * dx + dy * dy)));
            const ex = px - t * dx;
            const ey = py - t * dy;
            const d2 = ex * ex + ey * ey;
            if (d2 < best) {
              best = d2;
              nearest = s;
            }
          }
          const brightness = this.brightness[k]![nearest]!;
          const onBeam = Math.exp(-best / 0.25);
          const instant =
            Math.min(1.2, onBeam + 0.5 * Math.exp(-Math.sqrt(best) / 0.8)) * brightness;
          const core = onBeam * brightness;
          const head = Math.max(this.heads[k]![n]! * headKeep, core);
          const tail = Math.max(this.tails[k]![n]! * tailKeep, core);
          this.heads[k]![n] = head;
          this.tails[k]![n] = tail;
          const light = Math.max(instant, head, 0.55 * tail);
          dark *= 1 - Math.min(1, light);
          now += instant;
          total += light;
        }
        this.dots[n * 2] = Math.min(1, Math.max(0, 1 - dark));
        this.dots[n * 2 + 1] = Math.min(1, now / Math.max(1e-4, total));
      }
    }
  }
}

const roundedBox = (x: number, y: number, halfX: number, halfY: number, radius: number) => {
  const qx = Math.abs(x) - halfX + radius;
  const qy = Math.abs(y) - halfY + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
};

/** Draws the field centred in a `DOT_SCOPE_WIDTH` by `DOT_SCOPE_HEIGHT` context, in `color`. */
export function paintDotScope(
  context: CanvasRenderingContext2D,
  scope: DotScope,
  color: string,
  dark: boolean,
): void {
  const { columns, rows, dots } = scope;
  const halfX = DOT_SCOPE_WIDTH / 2;
  const halfY = DOT_SCOPE_HEIGHT / 2;
  const pitch = DOT_SCOPE_PITCH;
  const unlit = dark ? 0.07 : 0.085;
  const full = dark ? 0.96 : 1;
  const curve = dark ? 0.9 : 0.75;
  const presence = 0.5 + 0.5 * scope.live;
  context.clearRect(0, 0, DOT_SCOPE_WIDTH, DOT_SCOPE_HEIGHT);
  context.fillStyle = color;
  const fill = (x: number, y: number, radius: number, alpha: number) => {
    context.globalAlpha = Math.min(1, alpha);
    context.beginPath();
    context.arc(halfX + x, halfY + y, radius, 0, TAU);
    context.fill();
  };
  for (let j = 0; j < rows; j++) {
    const y = (j - (rows - 1) / 2) * pitch;
    const row = Math.abs(y) / halfY;
    const floor = unlit * (1 - 0.7 * smoothstep(0.35, 0.95, row)) * presence * scope.grid;
    for (let i = 0; i < columns; i++) {
      const x = (i - (columns - 1) / 2) * pitch;
      const mask = smoothstep(1.4, 4.6, -roundedBox(x, y, halfX, halfY, halfY));
      if (mask <= 0) continue;
      const n = j * columns + i;
      const power = Math.max(1e-5, dots[n * 2]!);
      const fresh = dots[n * 2 + 1]!;
      const alpha = floor + (full - floor) * power ** (curve * (1.4 - 0.4 * fresh));
      const radius =
        (0.25 + 0.17 * power ** 0.6) *
        (1 - (0.18 - 0.18 * fresh) * smoothstep(0.03, 0.2, power)) *
        pitch;
      const core = Math.min(0.9, power * power * 1.1) * (0.3 + 0.7 * fresh);
      const tone = 0.7 + 0.3 * core;
      if (power > 0.05) fill(x, y, radius * 2, 0.132 * power * power * mask * tone);
      fill(x, y, radius, alpha * mask * tone);
    }
  }
  context.globalAlpha = 1;
}
