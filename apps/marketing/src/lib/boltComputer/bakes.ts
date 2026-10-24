import { hash, makeGrid } from "./faces";
import {
  BEVEL,
  GASKET,
  HOUSING,
  KNOB,
  LED_PITCH,
  SCREEN_HOLE,
  SLIDER,
  SLOT,
  extents,
  sd,
  type V3,
} from "./geometry";
import { HALF, KEY, smooth } from "./light";

export const PLATE = extents(HOUSING, BEVEL);
export const GLASS = extents(SCREEN_HOLE, GASKET);
const GRID_COLS = Math.ceil((2 * GLASS.hx) / LED_PITCH);
const GRID_ROWS = Math.ceil((2 * GLASS.hy) / LED_PITCH);
export const newGrid = () => makeGrid(GRID_COLS, GRID_ROWS);
// The screen image reaches past the glass so the recess never shows a gap as it turns.
export const SCREEN = (() => {
  const { cols, rows } = newGrid();
  return {
    hx: Math.max(GLASS.hx, (cols / 2) * LED_PITCH) + 0.035,
    hy: Math.max(GLASS.hy, (rows / 2) * LED_PITCH) + 0.035,
  };
})();

export const makeCanvas = (w: number, h: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  return canvas;
};

export function context2d(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  return ctx;
}

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
const HANDLE_ROUND = 0.006;
const handle: Distance = (u, v) => {
  const qx = Math.abs(u - SLIDER.x) - (SLIDER.hw - HANDLE_ROUND);
  const qy = Math.abs(v - SLOT.y) - (SLIDER.hh - HANDLE_ROUND);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - HANDLE_ROUND
  );
};

/** How fully a control standing `height` off the plate hides the key light from a point. */
const shadowOf = (fn: Distance, u: number, v: number, height: number) =>
  1 - smooth(-0.004, 0.004, fn(u + KEY[0] * height, v + KEY[1] * height));

const controlShadow = (u: number, v: number) =>
  0.42 * Math.max(shadowOf(knob, u, v, 0.014), shadowOf(handle, u, v, 0.016));

function bakeFront(unit: number) {
  const lip = 0.03;
  const controlLip = 0.01;
  return bakeRelief(unit, (u, v, grain) => {
    for (const control of [knob, slot]) {
      const d = control(u, v);
      if (d < 0) return 0;
      if (d < controlLip)
        return rollInto(control, u, v, d, controlLip) + grain - controlShadow(u, v);
    }
    const dh = hole(u, v);
    if (dh >= 0) {
      return (dh < lip ? rollInto(hole, u, v, dh, lip) + grain : grain) - controlShadow(u, v);
    }
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

// The dark lens of an unlit LED, faintly tinted by the phosphor.
const UNLIT_LED = "rgba(71,77,53,0.16)";

/** The screen's dark phosphor and the unlit LEDs, which never change. */
export function bakeScreenBase(w: number, h: number, pitch: number, x0: number, y0: number) {
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
  g.addColorStop(0, "#18201b");
  g.addColorStop(1, "#070a08");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const cell = pitch * 0.8;
  const off = (pitch - cell) / 2;
  ctx.fillStyle = UNLIT_LED;
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

export function grainPattern(ctx: CanvasRenderingContext2D) {
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

const GROOVE_ALBEDO: V3 = [44, 48, 34];
const RIDGES = [-0.008, 0, 0.008];

/** `albedo` lit the way bakeRelief lights the shell: toward white above zero, black below. */
const lit = (albedo: V3, light: number): V3 => {
  const tone = light > 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(light));
  return [
    albedo[0] + (tone - albedo[0]) * k,
    albedo[1] + (tone - albedo[1]) * k,
    albedo[2] + (tone - albedo[2]) * k,
  ];
};

/** The handle's top is flat, its edges roll off over `bevel`, and ridges are cut across its middle. */
function handleLight(u: number, v: number, inside: number): number {
  const bevel = 0.007;
  let [nx, ny, nz] = [0, 0, 1];
  if (inside < bevel) {
    const [gx, gy] = grad(handle, u, v);
    const th = (1 - inside / bevel) * 1.25;
    [nx, ny, nz] = [gx * Math.sin(th), gy * Math.sin(th), Math.cos(th)];
  } else if (Math.abs(v - SLOT.y) < SLIDER.hh * 0.55) {
    for (const ridge of RIDGES) {
      const across = (u - SLIDER.x - ridge) / 0.0024;
      if (Math.abs(across) < 1) nx = -across * 0.9;
    }
  }
  return tilt(nx, ny, nz, 0.6, 28) * 1.15;
}

/** The slot's floor, the knob and the slider's handle, coloured and lit over the plate. */
export function bakeControls(unit: number, knobs: V3) {
  // The handle is a shade darker than the knob, as on the app icon.
  const handleAlbedo: V3 = [knobs[0] * 0.88, knobs[1] * 0.88, knobs[2] * 0.88];
  const canvas = makeCanvas(PLATE.hx * 2 * unit, PLATE.hy * 2 * unit);
  const ctx = context2d(canvas);
  const px = (PLATE.hx * 2) / canvas.width;
  const left = Math.max(0, Math.floor((KNOB.x - KNOB.r + PLATE.hx) / px) - 2);
  const right = Math.min(canvas.width, Math.ceil((SLOT.x + SLOT.hw + PLATE.hx) / px) + 2);
  const top = Math.max(
    0,
    Math.floor((Math.min(KNOB.y - KNOB.r, SLOT.y - SLIDER.hh) + PLATE.hy) / px) - 2,
  );
  const bottom = Math.min(
    canvas.height,
    Math.ceil((Math.max(KNOB.y + KNOB.r, SLOT.y + SLIDER.hh) + PLATE.hy) / px) + 2,
  );
  const image = ctx.createImageData(right - left, bottom - top);
  for (let iy = top; iy < bottom; iy++) {
    const v = -PLATE.hy + (iy + 0.5) * px;
    for (let ix = left; ix < right; ix++) {
      const u = -PLATE.hx + (ix + 0.5) * px;
      const grain = (hash(ix, iy) - 0.5) * 0.04;
      let color: V3 | null = null;
      let cover = 0;
      const dk = knob(u, v);
      const dh = handle(u, v);
      const ds = slot(u, v);
      if (dk < px) {
        const dx = (u - KNOB.x) / KNOB.r;
        const dy = (v - KNOB.y) / KNOB.r;
        const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)) + 0.18;
        color = lit(knobs, tilt(dx, dy, nz, 0.6, 80) + grain);
        cover = 0.5 - dk / px;
      } else if (dh < px) {
        color = lit(handleAlbedo, handleLight(u, v, -dh) + grain);
        cover = 0.5 - dh / px;
      } else if (ds < px) {
        // The floor sits below the plate, so its top wall shades it from the key light.
        const walled = smooth(-0.004, 0.004, slot(u + KEY[0] * 0.02, v + KEY[1] * 0.02));
        const light = -0.55 * walled - 0.5 * shadowOf(handle, u, v, 0.016) + grain;
        color = lit(GROOVE_ALBEDO, light);
        cover = 0.5 - ds / px;
      }
      if (!color) continue;
      const i = ((iy - top) * (right - left) + (ix - left)) * 4;
      image.data[i] = color[0];
      image.data[i + 1] = color[1];
      image.data[i + 2] = color[2];
      image.data[i + 3] = Math.round(Math.min(1, Math.max(0, cover)) * 255);
    }
  }
  ctx.putImageData(image, left, top);
  return canvas;
}

export interface Bakes {
  readonly front: HTMLCanvasElement;
  readonly back: HTMLCanvasElement;
  readonly glass: HTMLCanvasElement;
}

export function bakeTextures(unit: number): Bakes {
  return {
    front: bakeFront(unit),
    back: bakeBack(unit),
    glass: bakeGlass(SCREEN.hx * 2 * unit, SCREEN.hy * 2 * unit),
  };
}
