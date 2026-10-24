export type V3 = readonly [number, number, number];
export type Matrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** A rounded rectangle: the rectangle of corner centres, grown by `r`. */
export interface Outline {
  readonly cx: number;
  readonly cy: number;
  readonly bx: number;
  readonly by: number;
  readonly r: number;
}

// Head units: x right, y down, z toward the viewer. Proportions follow the app icon.
export const HOUSING: Outline = { cx: 0, cy: 0, bx: 0.23, by: 0.23, r: 0.19 };
export const SCREEN_HOLE: Outline = { cx: 0, cy: -0.04, bx: 0.18, by: 0.145, r: 0.12 };
export const DEPTH = 0.6;
export const BEVEL = 0.075;
export const GASKET = 0.022;
export const RECESS = 0.03;
export const LED_PITCH = 0.0155;
export const KNOB = { x: -0.25, y: 0.29, r: 0.036 } as const;
export const SLOT = { x: 0.105, y: 0.29, hw: 0.148, hh: 0.015 } as const;
export const SLIDER = { x: 0.232, hw: 0.018, hh: 0.026 } as const;

export function extents(o: Outline, inset = 0) {
  return { hx: o.bx + o.r - inset, hy: o.by + o.r - inset };
}

/** Signed distance to `o` shrunk by `inset`, negative inside. */
export function sd(o: Outline, x: number, y: number, inset = 0): number {
  const qx = Math.abs(x - o.cx) - o.bx;
  const qy = Math.abs(y - o.cy) - o.by;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - (o.r - inset)
  );
}

export function trace(ctx: CanvasRenderingContext2D, o: Outline, inset = 0) {
  const r = Math.max(0.0005, o.r - inset);
  ctx.roundRect(o.cx - o.bx - r, o.cy - o.by - r, 2 * (o.bx + r), 2 * (o.by + r), r);
}

/** Roll · Yaw · Pitch, row-major. */
export function rotation(yaw: number, pitch: number, roll: number): Matrix {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const [a0, a1, a2, a3, a4, a5] = [cy, sy * sp, sy * cp, 0, cp, -sp];
  return [
    cr * a0 - sr * a3,
    cr * a1 - sr * a4,
    cr * a2 - sr * a5,
    sr * a0 + cr * a3,
    sr * a1 + cr * a4,
    sr * a2 + cr * a5,
    -sy,
    cy * sp,
    cy * cp,
  ];
}

export function rotate(m: Matrix, x: number, y: number, z: number): V3 {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

export interface Mesh {
  readonly pos: Float32Array;
  readonly quads: Uint16Array;
  readonly normals: Float32Array;
}

const CORNER_STEPS = 14;
const BEVEL_STEPS = 10;
const CORNER_ARCS = [
  [-1, -1, -Math.PI],
  [1, -1, -Math.PI / 2],
  [1, 1, 0],
  [-1, 1, Math.PI / 2],
] as const;

/**
 * The housing's sides and rolled edges as quads. The flat front and back are
 * drawn as plates, since an affine map is exact for them under an orthographic view.
 */
function buildBody(): Mesh {
  const { bx, by, r } = HOUSING;
  const zf = DEPTH / 2;
  const outline: Array<readonly [number, number, number, number]> = [];
  for (const [sx, sy, a0] of CORNER_ARCS) {
    for (let i = 0; i <= CORNER_STEPS; i++) {
      const a = a0 + (i / CORNER_STEPS) * (Math.PI / 2);
      outline.push([sx * bx, sy * by, Math.cos(a), Math.sin(a)]);
    }
  }
  const profile: Array<readonly [number, number, number]> = [];
  for (let i = BEVEL_STEPS; i >= 0; i--) {
    const t = (i / BEVEL_STEPS) * (Math.PI / 2);
    profile.push([-zf + BEVEL - BEVEL * Math.sin(t), BEVEL * (1 - Math.cos(t)), -t]);
  }
  for (let i = 0; i <= BEVEL_STEPS; i++) {
    const t = (i / BEVEL_STEPS) * (Math.PI / 2);
    profile.push([zf - BEVEL + BEVEL * Math.sin(t), BEVEL * (1 - Math.cos(t)), t]);
  }
  const pos: number[] = [];
  const vertexNormals: number[] = [];
  for (const [z, inset, t] of profile) {
    for (const [cx, cy, nx, ny] of outline) {
      pos.push(cx + (r - inset) * nx, cy + (r - inset) * ny, z);
      vertexNormals.push(nx * Math.cos(t), ny * Math.cos(t), Math.sin(t));
    }
  }
  const samples = outline.length;
  const quads: number[] = [];
  for (let k = 0; k < profile.length - 1; k++) {
    for (let j = 0; j < samples; j++) {
      const next = (j + 1) % samples;
      quads.push(
        k * samples + j,
        k * samples + next,
        (k + 1) * samples + next,
        (k + 1) * samples + j,
      );
    }
  }
  const normals = new Float32Array((quads.length / 4) * 3);
  for (let q = 0; q < quads.length / 4; q++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 0; k < 4; k++) {
      const i = (quads[q * 4 + k] ?? 0) * 3;
      x += vertexNormals[i] ?? 0;
      y += vertexNormals[i + 1] ?? 0;
      z += vertexNormals[i + 2] ?? 0;
    }
    const l = Math.hypot(x, y, z) || 1;
    normals.set([x / l, y / l, z / l], q * 3);
  }
  return { pos: new Float32Array(pos), quads: new Uint16Array(quads), normals };
}

let body: Mesh | null = null;
export function bodyMesh(): Mesh {
  body ??= buildBody();
  return body;
}
