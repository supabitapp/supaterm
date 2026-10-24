import {
  FACES,
  SCREEN_COLOR,
  hash,
  makeGrid,
  tear,
  type BoltComputerState,
  type Face,
  type Grid,
} from "./faces";
import {
  BEVEL,
  DEPTH,
  GASKET,
  HOUSING,
  KNOB,
  LED_PITCH,
  RECESS,
  SCREEN_HOLE,
  SLIDER,
  SLOT,
  bodyMesh,
  extents,
  rotate,
  rotation,
  sd,
  trace,
  type Matrix,
  type V3,
} from "./geometry";
import { HALF, KEY, css, linear, radiance, smooth, type Material } from "./light";
import { FADE, POWER_ON, restPose, type BoltComputerSim, type Pose } from "./sim";

type RGB = readonly [number, number, number];

const SHELL: Material = {
  albedo: linear([226, 219, 202]),
  f0: 0.04,
  spec: 0.3,
  shininess: 40,
  rim: 0.5,
};
const PHOSPHOR: RGB = [255, 240, 106];

const OUTER = extents(HOUSING);
const PLATE = extents(HOUSING, BEVEL);
const GLASS = extents(SCREEN_HOLE, GASKET);
const GRID_COLS = Math.ceil((2 * GLASS.hx) / LED_PITCH);
const GRID_ROWS = Math.ceil((2 * GLASS.hy) / LED_PITCH);
const newGrid = () => makeGrid(GRID_COLS, GRID_ROWS);
// The screen image reaches past the glass so the recess never shows a gap as it turns.
const SCREEN = (() => {
  const { cols, rows } = newGrid();
  return {
    hx: Math.max(GLASS.hx, (cols / 2) * LED_PITCH) + 0.035,
    hy: Math.max(GLASS.hy, (rows / 2) * LED_PITCH) + 0.035,
  };
})();

const TRAVEL = { hop: 0.3, overshoot: 0.13, shadow: 0.22, side: 0.12 } as const;
const BOX_INSET = 0.05;

/**
 * Where the computer sits, in CSS px. The element is a `box` square holding the
 * housing at rest; the canvas reaches past it by `pad*` so hops and the floor's
 * shadow draw outside the layout box. `unit` is one head unit.
 */
export interface Frame {
  readonly box: number;
  readonly padTop: number;
  readonly padBottom: number;
  readonly padSide: number;
  readonly unit: number;
  readonly cx: number;
  readonly cy: number;
}

export function frameFor(box: number): Frame {
  const unit = (box * (1 - 2 * BOX_INSET)) / (2 * Math.max(OUTER.hx, OUTER.hy));
  const above = box / 2 - OUTER.hy * unit;
  const reachUp = (TRAVEL.hop + TRAVEL.overshoot) * unit;
  const reachDown = box / 2 + (OUTER.hy + TRAVEL.shadow) * unit;
  const reachSide = box / 2 + (OUTER.hx + TRAVEL.side) * unit;
  const padTop = Math.ceil(Math.max(0, reachUp - above) + 1);
  const padBottom = Math.ceil(Math.max(0, reachDown - box) + 1);
  const padSide = Math.ceil(Math.max(0, reachSide - box) + 1);
  return { box, padTop, padBottom, padSide, unit, cx: padSide + box / 2, cy: padTop + box / 2 };
}

const makeCanvas = (w: number, h: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  return canvas;
};

function context2d(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  return ctx;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const rgb = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

/** Lighting of a tilted bit of the plate, relative to the flat plate. */
function tilt(nx: number, ny: number, nz: number, gloss = 0.55, power = 36): number {
  const l = Math.hypot(nx, ny, nz);
  const [x, y, z] = [nx / l, ny / l, nz / l];
  const diffuse = (x * KEY[0] + y * KEY[1] + z * KEY[2] - KEY[2]) * 0.95;
  const spec = gloss * Math.max(0, x * HALF[0] + y * HALF[1] + z * HALF[2]) ** power;
  return diffuse + spec - gloss * HALF[2] ** power;
}

type Distance = (u: number, v: number) => number;

function grad(fn: Distance, u: number, v: number): readonly [number, number] {
  const e = 0.0015;
  const gx = fn(u + e, v) - fn(u - e, v);
  const gy = fn(u, v + e) - fn(u, v - e);
  const l = Math.hypot(gx, gy) || 1;
  return [gx / l, gy / l];
}

/** The plate rolling down into a hole `fn` describes, `d` outside its edge. */
function rollInto(fn: Distance, u: number, v: number, d: number, width: number): number {
  const [gx, gy] = grad(fn, u, v);
  const s = 1 - d / width;
  const th = s * s * 1.25;
  return tilt(-gx * Math.sin(th), -gy * Math.sin(th), Math.cos(th));
}

/**
 * Bake a relief over the plate as light: positive brightens toward white,
 * negative darkens toward black, laid over the shell with that alpha.
 */
function bakeRelief(unit: number, fn: (u: number, v: number, grain: number) => number) {
  const canvas = makeCanvas(PLATE.hx * 2 * unit, PLATE.hy * 2 * unit);
  const ctx = context2d(canvas);
  const image = ctx.createImageData(canvas.width, canvas.height);
  const px = (PLATE.hx * 2) / canvas.width;
  for (let iy = 0; iy < canvas.height; iy++) {
    const v = -PLATE.hy + (iy + 0.5) * px;
    for (let ix = 0; ix < canvas.width; ix++) {
      const u = -PLATE.hx + (ix + 0.5) * px;
      const cover = Math.min(1, Math.max(0, 0.5 - sd(HOUSING, u, v, BEVEL) / px));
      if (cover <= 0) continue;
      const value = fn(u, v, (hash(ix, iy) - 0.5) * 0.07);
      const i = (iy * canvas.width + ix) * 4;
      const tone = value > 0 ? 255 : 0;
      image.data[i] = tone;
      image.data[i + 1] = tone;
      image.data[i + 2] = tone;
      image.data[i + 3] = Math.round(Math.min(1, Math.abs(value)) * cover * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function screw(u: number, v: number, cx: number, cy: number, angle: number): number | null {
  const rs = 0.013;
  const dx = u - cx;
  const dy = v - cy;
  const d = Math.hypot(dx, dy);
  if (d > rs + 0.006) return null;
  if (d > rs) return -0.5 * (1 - (d - rs) / 0.006);
  const nz = Math.sqrt(Math.max(0, 1 - (d / rs) ** 2)) + 0.6;
  const across = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
  if (across < 0.0026 && d < rs * 0.8) return -0.65;
  return tilt(dx / rs, dy / rs, nz, 0.9, 30) * 1.3 + 0.08;
}

const hole: Distance = (u, v) => sd(SCREEN_HOLE, u, v);
const glass: Distance = (u, v) => sd(SCREEN_HOLE, u, v, GASKET);
const knob: Distance = (u, v) => Math.hypot(u - KNOB.x, v - KNOB.y) - KNOB.r;
const slot: Distance = (u, v) =>
  Math.hypot(Math.max(0, Math.abs(u - SLOT.x) - (SLOT.hw - SLOT.hh)), v - SLOT.y) - SLOT.hh;

function bakeFront(unit: number) {
  const lip = 0.03;
  const controlLip = 0.01;
  return bakeRelief(unit, (u, v, grain) => {
    for (const control of [knob, slot]) {
      const d = control(u, v);
      if (d < 0) return 0;
      if (d < controlLip) return rollInto(control, u, v, d, controlLip) + grain;
    }
    const dh = hole(u, v);
    if (dh >= 0) return dh < lip ? rollInto(hole, u, v, dh, lip) + grain : grain;
    const dg = glass(u, v);
    if (dg >= 0) {
      const [gx, gy] = grad(glass, u, v);
      const th = (dg / GASKET - 0.45) * 2.2;
      return tilt(gx * Math.sin(th), gy * Math.sin(th), Math.cos(th), 0.22, 14) * 0.7 + grain * 0.4;
    }
    // The lip's shadow cast onto the glass, darker toward the edge.
    const k = 0.05;
    const blocked = smooth(-0.012, 0.012, glass(u - KEY[0] * k, v - KEY[1] * k));
    return -(0.5 * blocked + 0.32 * Math.exp(dg / 0.014));
  });
}

const BACK_SCREWS = [-135, -45, 45, 135].map((degrees, i) => {
  const a = (degrees * Math.PI) / 180;
  const reach = HOUSING.r - (BEVEL + 0.07);
  return [
    Math.sign(Math.cos(a)) * HOUSING.bx + Math.cos(a) * reach,
    Math.sign(Math.sin(a)) * HOUSING.by + Math.sin(a) * reach,
    0.5 + i * 0.9,
  ] as const;
});
const VENTS = [-0.12, -0.065, -0.01, 0.045, 0.1];

function bakeBack(unit: number) {
  const panel: Distance = (u, v) => sd(HOUSING, u, v, BEVEL + 0.04);
  return bakeRelief(unit, (u, v, grain) => {
    for (const [cx, cy, angle] of BACK_SCREWS) {
      const s = screw(u, v, cx, cy, angle);
      if (s !== null) return s;
    }
    const dp = panel(u, v);
    if (Math.abs(dp) < 0.006) {
      const [gx, gy] = grad(panel, u, v);
      const th = (dp / 0.006) * 1.1;
      return tilt(-gx * Math.sin(th), -gy * Math.sin(th), Math.cos(th)) * 0.9 - 0.18;
    }
    for (const vy of VENTS) {
      const vent: Distance = (a, b) => Math.hypot(Math.max(0, Math.abs(a) - 0.196), b - vy) - 0.014;
      const d = vent(u, v);
      if (d < 0) return -0.72 - 0.15 * smooth(-0.014, 0, vy - v);
      if (d < 0.01) return rollInto(vent, u, v, d, 0.01) + grain;
    }
    return grain;
  });
}

/** The screen's dark phosphor and the unlit LEDs, which never change. */
function bakeScreenBase(w: number, h: number, pitch: number, x0: number, y0: number, led: RGB) {
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
  g.addColorStop(0, "#18201b");
  g.addColorStop(1, "#070a08");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const cell = pitch * 0.8;
  const off = (pitch - cell) / 2;
  ctx.fillStyle = `rgba(${Math.round(40 + led[0] * 0.12)},${Math.round(48 + led[1] * 0.12)},${Math.round(40 + led[2] * 0.12)},0.16)`;
  const c0 = -Math.ceil(x0 / pitch);
  const c1 = Math.ceil((w - x0) / pitch);
  const r0 = -Math.ceil(y0 / pitch);
  const r1 = Math.ceil((h - y0) / pitch);
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++)
      ctx.fillRect(x0 + c * pitch + off, y0 + r * pitch + off, cell, cell);
  }
  return canvas;
}

/** The glass over the LEDs: a vignette, a curved reflection, a cool sheen. */
function bakeGlass(w: number, h: number) {
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  const vignette = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.3,
    w / 2,
    h / 2,
    Math.hypot(w, h) * 0.55,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  const top = ctx.createLinearGradient(0, 0, 0, h);
  top.addColorStop(0, "rgba(210,230,200,0.09)");
  top.addColorStop(0.42, "rgba(210,230,200,0.015)");
  top.addColorStop(0.43, "rgba(210,230,200,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w * 0.3, h * 0.2);
  ctx.scale(1, 0.45);
  const spot = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.35);
  spot.addColorStop(0, "rgba(255,255,255,0.07)");
  spot.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(-w, -h * 3, w * 2, h * 6);
  return canvas;
}

function grainPattern(ctx: CanvasRenderingContext2D) {
  const canvas = makeCanvas(128, 128);
  const g = context2d(canvas);
  const image = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const tone = hash(i, 7) > 0.5 ? 255 : 0;
    image.data[i * 4] = tone;
    image.data[i * 4 + 1] = tone;
    image.data[i * 4 + 2] = tone;
    image.data[i * 4 + 3] = Math.round(hash(i, 13) * 9);
  }
  g.putImageData(image, 0, 0);
  return ctx.createPattern(canvas, "repeat");
}

interface Bakes {
  readonly front: HTMLCanvasElement;
  readonly back: HTMLCanvasElement;
  readonly glass: HTMLCanvasElement;
}

// Bakes depend only on the size, so every computer on the page at that size shares them.
const bakes = new Map<number, Bakes>();
function bakesFor(unit: number): Bakes {
  const key = Math.round(unit);
  let b = bakes.get(key);
  if (!b) {
    b = {
      front: bakeFront(unit),
      back: bakeBack(unit),
      glass: bakeGlass(SCREEN.hx * 2 * unit, SCREEN.hy * 2 * unit),
    };
    bakes.set(key, b);
  }
  return b;
}

function drawControls(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.roundRect(SLOT.x - SLOT.hw, SLOT.y - SLOT.hh, SLOT.hw * 2, SLOT.hh * 2, SLOT.hh);
  const groove = ctx.createLinearGradient(0, SLOT.y - SLOT.hh, 0, SLOT.y + SLOT.hh);
  groove.addColorStop(0, "#121510");
  groove.addColorStop(1, "#2e3324");
  ctx.fillStyle = groove;
  ctx.fill();

  ctx.beginPath();
  ctx.roundRect(SLIDER.x - SLIDER.hw, SLOT.y - SLIDER.hh, SLIDER.hw * 2, SLIDER.hh * 2, 0.006);
  const handle = ctx.createLinearGradient(0, SLOT.y - SLIDER.hh, 0, SLOT.y + SLIDER.hh);
  handle.addColorStop(0, "#6b703d");
  handle.addColorStop(1, "#30331a");
  ctx.fillStyle = handle;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(KNOB.x, KNOB.y, KNOB.r, 0, Math.PI * 2);
  const dome = ctx.createRadialGradient(
    KNOB.x - KNOB.r * 0.35,
    KNOB.y - KNOB.r * 0.4,
    KNOB.r * 0.1,
    KNOB.x,
    KNOB.y,
    KNOB.r,
  );
  dome.addColorStop(0, "#929659");
  dome.addColorStop(0.55, "#5f6233");
  dome.addColorStop(1, "#30321a");
  ctx.fillStyle = dome;
  ctx.fill();
}

/** Everything that depends on the drawn size. */
interface Sized {
  readonly unit: number;
  readonly bakes: Bakes;
  readonly screen: HTMLCanvasElement;
  readonly pitch: number;
  readonly x0: number;
  readonly y0: number;
}

export class BoltComputerRenderer {
  private sized: Sized | null = null;
  private screenBase: { readonly key: string; readonly canvas: HTMLCanvasElement } | null = null;
  private layer: HTMLCanvasElement | null = null;
  private grain: CanvasPattern | null = null;
  private readonly grid: Grid = newGrid();
  private readonly previous: Grid = newGrid();
  private readonly tiny = makeCanvas(this.grid.cols, this.grid.rows);
  private readonly tinyHalf = makeCanvas(this.grid.cols / 2, this.grid.rows / 2);
  private tinyImage: ImageData | null = null;
  private readonly projected = new Float32Array(bodyMesh().pos.length);

  /** Paint a frame; with no sim, the state's still pose. */
  paint(
    canvas: HTMLCanvasElement,
    frame: Frame,
    sim: BoltComputerSim | null,
    state: BoltComputerState,
  ) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round((frame.box + 2 * frame.padSide) * dpr);
    const h = Math.round((frame.box + frame.padTop + frame.padBottom) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.draw(context2d(canvas), frame, dpr, sim?.pose ?? restPose(state), sim, state);
  }

  private prepare(unit: number, led: RGB): Sized {
    let sized = this.sized;
    if (!sized || Math.abs(unit - sized.unit) > 0.5) {
      const screen = makeCanvas(SCREEN.hx * 2 * unit, SCREEN.hy * 2 * unit);
      const pitch = LED_PITCH * unit;
      sized = {
        unit,
        bakes: bakesFor(unit),
        screen,
        pitch,
        x0: (screen.width - pitch * this.grid.cols) / 2,
        y0: (screen.height - pitch * this.grid.rows) / 2,
      };
      this.sized = sized;
      this.screenBase = null;
    }
    const key = led.join(",");
    if (this.screenBase?.key !== key) {
      const { screen, pitch, x0, y0 } = sized;
      this.screenBase = {
        key,
        canvas: bakeScreenBase(screen.width, screen.height, pitch, x0, y0, led),
      };
    }
    return sized;
  }

  private compose(sim: BoltComputerSim | null, state: BoltComputerState): Grid {
    const grid = this.grid;
    const g = grid.v;
    const { cols, rows } = grid;
    g.fill(0);
    if (!sim) {
      FACES[state](grid, 0.4);
      return grid;
    }
    FACES[sim.shown](grid, sim.since);
    // A cross-fade from the last face, with a flicker of glitch.
    if (sim.switched < FADE) {
      const p = this.previous;
      p.v.fill(0);
      FACES[sim.previous](p, sim.since + 10);
      const k = sim.switched / FADE;
      for (let i = 0; i < g.length; i++) g[i] = (g[i] ?? 0) * k + (p.v[i] ?? 0) * (1 - k);
      if (sim.switched < 0.13) {
        const seed = Math.floor(sim.age * 30);
        tear(grid, seed, 1);
        for (let i = 0; i < g.length; i++) {
          if (hash(i, seed) > 0.96) g[i] = Math.max(g[i] ?? 0, 0.3);
        }
      }
    }
    // Switching on: a bright line that opens to the full screen.
    if (sim.age < POWER_ON) {
      const open = smooth(0.08, 0.5, sim.age) * (rows / 2 + 0.5);
      for (let r = 0; r < rows; r++) {
        const d = Math.abs(r - (rows - 1) / 2);
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (d > open) g[i] = 0;
          else if (d > open - 1.2) g[i] = Math.max(g[i] ?? 0, 0.85 * (1 - sim.age / POWER_ON));
        }
      }
    }
    return grid;
  }

  private drawScreen(sized: Sized, grid: Grid, led: RGB) {
    const ctx = context2d(sized.screen);
    const { cols, rows, v: g } = grid;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (this.screenBase) ctx.drawImage(this.screenBase.canvas, 0, 0);
    const { pitch, x0, y0 } = sized;
    // Bloom first: the matrix at one pixel per LED, scaled up smooth. The cells
    // go over it so they keep the phosphor's colour instead of washing to white.
    const tiny = context2d(this.tiny);
    this.tinyImage ??= tiny.createImageData(cols, rows);
    const d = this.tinyImage.data;
    for (let i = 0; i < cols * rows; i++) {
      d[i * 4] = led[0];
      d[i * 4 + 1] = led[1];
      d[i * 4 + 2] = led[2];
      d[i * 4 + 3] = Math.round(Math.min(1, g[i] ?? 0) * 255);
    }
    tiny.putImageData(this.tinyImage, 0, 0);
    const half = context2d(this.tinyHalf);
    half.clearRect(0, 0, this.tinyHalf.width, this.tinyHalf.height);
    half.imageSmoothingEnabled = true;
    half.drawImage(this.tiny, 0, 0, this.tinyHalf.width, this.tinyHalf.height);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.45;
    ctx.drawImage(this.tiny, x0, y0, cols * pitch, rows * pitch);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(this.tinyHalf, x0 - pitch, y0 - pitch, (cols + 2) * pitch, (rows + 2) * pitch);
    ctx.globalCompositeOperation = "source-over";
    const color = rgb(led);
    const hot = rgb(mix(led, [255, 255, 255], 0.35));
    const cell = pitch * 0.8;
    const off = (pitch - cell) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = g[r * cols + c] ?? 0;
        if (v < 0.01) continue;
        const x = x0 + c * pitch + off;
        const y = y0 + r * pitch + off;
        ctx.globalAlpha = Math.min(1, v);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, cell, cell);
        ctx.globalAlpha = Math.min(1, v) * 0.5;
        ctx.fillStyle = hot;
        ctx.fillRect(x + cell * 0.2, y + cell * 0.2, cell * 0.6, cell * 0.6);
      }
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(sized.bakes.glass, 0, 0);
  }

  private draw(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    dpr: number,
    pose: Pose,
    sim: BoltComputerSim | null,
    state: BoltComputerState,
  ) {
    const U = frame.unit * dpr;
    const shown: Face = sim ? sim.shown : state;
    let led: RGB = SCREEN_COLOR[shown] ?? PHOSPHOR;
    if (sim && sim.switched < FADE) {
      const was = SCREEN_COLOR[sim.previous] ?? PHOSPHOR;
      led = mix(was, led, sim.switched / FADE);
    }
    const sized = this.prepare(U, led);
    if (this.layer?.width !== ctx.canvas.width || this.layer.height !== ctx.canvas.height) {
      this.layer = makeCanvas(ctx.canvas.width, ctx.canvas.height);
      this.grain = grainPattern(ctx);
    }
    const layerCanvas = this.layer;
    const layer = context2d(layerCanvas);

    const R = rotation(pose.yaw, pose.pitch, pose.roll);
    const cx = frame.cx * dpr;
    const rest = frame.cy * dpr;
    const cy = rest - pose.lift * U;
    const by = cy + OUTER.hy * U;
    const P = (x: number, y: number, z: number): V3 => {
      const r = rotate(R, x, y, z);
      return [cx + r[0] * U * pose.sx, by + (cy + r[1] * U - by) * pose.sy, r[2]];
    };
    const plane = (c: CanvasRenderingContext2D, z: number, flip: boolean) => {
      const o = P(0, 0, z);
      const ex = P(flip ? -1 : 1, 0, z);
      const ey = P(0, 1, z);
      c.setTransform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // The floor's shadow, smaller and fainter the higher the computer hops.
    const up = Math.max(0, pose.lift);
    const shadowRadius = U * OUTER.hx * (1 - up * 0.9) * pose.sx;
    ctx.save();
    ctx.translate(cx, rest + (OUTER.hy + 0.11) * U);
    ctx.scale(1, 0.16);
    const floor = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowRadius);
    const alpha = 0.55 * Math.max(0, 1 - up * 1.6);
    floor.addColorStop(0, `rgba(0,0,0,${alpha})`);
    floor.addColorStop(0.55, `rgba(0,0,0,${alpha * 0.45})`);
    floor.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(0, 0, shadowRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // The housing goes on its own layer so the grain stays on it.
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.globalCompositeOperation = "source-over";
    layer.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
    this.drawBody(layer, P, R, U);
    const frontZ = R[8];
    const zf = DEPTH / 2;
    const facing = Math.abs(frontZ) > 0.005 ? Math.sign(frontZ) : 0;
    if (facing !== 0) {
      const dome = 0.17;
      plane(layer, facing * zf, facing < 0);
      const at = (dx: number, dy: number) => {
        const w = rotate(R, dx * facing, dy, facing);
        const l = Math.hypot(w[0], w[1], w[2]);
        return css(radiance(SHELL, w[0] / l, w[1] / l, w[2] / l));
      };
      layer.beginPath();
      trace(layer, HOUSING, BEVEL - 0.002);
      const vertical = layer.createLinearGradient(0, -PLATE.hy, 0, PLATE.hy);
      vertical.addColorStop(0, at(0, -dome));
      vertical.addColorStop(0.5, at(0, 0));
      vertical.addColorStop(1, at(0, dome));
      layer.fillStyle = vertical;
      layer.fill();
      const horizontal = layer.createLinearGradient(-PLATE.hx, 0, PLATE.hx, 0);
      horizontal.addColorStop(0, at(-dome, 0));
      horizontal.addColorStop(0.5, at(0, 0));
      horizontal.addColorStop(1, at(dome, 0));
      layer.globalAlpha = 0.5;
      layer.fillStyle = horizontal;
      layer.fill();
      layer.globalAlpha = 1;
    }
    if (this.grain) {
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.globalCompositeOperation = "source-atop";
      this.grain.setTransform(new DOMMatrix().translate(cx, cy));
      layer.fillStyle = this.grain;
      layer.fillRect(0, 0, layerCanvas.width, layerCanvas.height);
      layer.globalCompositeOperation = "source-over";
    }
    ctx.drawImage(layerCanvas, 0, 0);

    if (facing > 0) {
      ctx.save();
      plane(ctx, zf, false);
      ctx.beginPath();
      trace(ctx, SCREEN_HOLE);
      ctx.fillStyle = "#0a0d0b";
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      trace(ctx, SCREEN_HOLE, GASKET);
      ctx.clip();
      this.drawScreen(sized, this.compose(sim, state), led);
      // The glass sits behind the bezel, so it slides against it as the computer turns.
      plane(ctx, zf - RECESS, false);
      ctx.drawImage(
        sized.screen,
        -SCREEN.hx,
        SCREEN_HOLE.cy - SCREEN.hy,
        SCREEN.hx * 2,
        SCREEN.hy * 2,
      );
      plane(ctx, zf, false);
      const s = -0.05 - pose.yaw * 0.9 + pose.pitch * 0.5;
      const y = SCREEN_HOLE.cy;
      const sheen = ctx.createLinearGradient(-0.55 + s, y - 0.35, 0.15 + s, y + 0.35);
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.36, "rgba(255,255,255,0)");
      sheen.addColorStop(0.43, "rgba(230,240,220,0.075)");
      sheen.addColorStop(0.5, "rgba(255,255,255,0)");
      sheen.addColorStop(0.58, "rgba(255,255,255,0)");
      sheen.addColorStop(0.61, "rgba(230,240,220,0.04)");
      sheen.addColorStop(0.65, "rgba(255,255,255,0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(-GLASS.hx, y - GLASS.hy, GLASS.hx * 2, GLASS.hy * 2);
      ctx.restore();
      ctx.drawImage(sized.bakes.front, -PLATE.hx, -PLATE.hy, PLATE.hx * 2, PLATE.hy * 2);
      drawControls(ctx);
      ctx.restore();
    } else if (facing < 0) {
      ctx.save();
      plane(ctx, -zf, true);
      ctx.drawImage(sized.bakes.back, -PLATE.hx, -PLATE.hy, PLATE.hx * 2, PLATE.hy * 2);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawBody(
    ctx: CanvasRenderingContext2D,
    P: (x: number, y: number, z: number) => V3,
    R: Matrix,
    U: number,
  ) {
    const { pos, quads, normals } = bodyMesh();
    const projected = this.projected;
    for (let i = 0; i < pos.length; i += 3) {
      const p = P(pos[i] ?? 0, pos[i + 1] ?? 0, pos[i + 2] ?? 0);
      projected[i] = p[0];
      projected[i + 1] = p[1];
      projected[i + 2] = p[2];
    }
    const at = (quad: number, corner: number) => (quads[quad * 4 + corner] ?? 0) * 3;
    // The housing is convex, so culling back faces and painting far to near is exact.
    const order: Array<readonly [number, number]> = [];
    for (let k = 0; k < quads.length / 4; k++) {
      const nx = normals[k * 3] ?? 0;
      const ny = normals[k * 3 + 1] ?? 0;
      const nz = normals[k * 3 + 2] ?? 0;
      if (R[6] * nx + R[7] * ny + R[8] * nz < -0.03) continue;
      let depth = 0;
      for (let j = 0; j < 4; j++) depth += projected[at(k, j) + 2] ?? 0;
      order.push([depth, k]);
    }
    order.sort((a, b) => a[0] - b[0]);
    ctx.lineWidth = Math.max(0.6, U / 260);
    ctx.lineJoin = "round";
    for (const [, k] of order) {
      const w = rotate(R, normals[k * 3] ?? 0, normals[k * 3 + 1] ?? 0, normals[k * 3 + 2] ?? 0);
      const color = css(radiance(SHELL, w[0], w[1], w[2]));
      ctx.beginPath();
      for (let j = 0; j < 4; j++) {
        const i = at(k, j);
        if (j === 0) ctx.moveTo(projected[i] ?? 0, projected[i + 1] ?? 0);
        else ctx.lineTo(projected[i] ?? 0, projected[i + 1] ?? 0);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.fill();
      ctx.stroke();
    }
  }
}
