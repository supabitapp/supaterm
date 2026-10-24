import type { V3 } from "./geometry";

export interface Material {
  readonly albedo: V3;
  /** Clear-coat reflectance face on; it rises to 1 at grazing angles. */
  readonly f0: number;
  readonly spec: number;
  readonly shininess: number;
  readonly rim: number;
}

const unit = (x: number, y: number, z: number): V3 => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

export const KEY = unit(-0.5, -0.78, 0.62);
const FILL = unit(0.85, 0.15, 0.5);
const BACK = unit(0.55, -0.55, -0.62);
export const HALF = unit(KEY[0], KEY[1], KEY[2] + 1);

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function environment(rx: number, ry: number, rz: number): number {
  const up = -ry;
  const horizon = 0.05 + 0.12 * smooth(-0.25, 0.3, up);
  const softbox = 1.1 * smooth(0.42, 0.78, up) * smooth(-0.9, -0.2, rz - 0.6 * Math.abs(rx));
  const window = 2.6 * smooth(0.86, 0.97, rx * KEY[0] + ry * KEY[1] + rz * KEY[2]);
  const strip = 0.5 * smooth(0.6, 0.85, -rx) * smooth(-0.35, 0.05, up) * (1 - smooth(0.2, 0.5, up));
  return horizon + softbox + window + strip;
}

export function linear(rgb: V3): V3 {
  return [(rgb[0] / 255) ** 2.2, (rgb[1] / 255) ** 2.2, (rgb[2] / 255) ** 2.2];
}

function display(x: number): number {
  const t = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return Math.round(255 * Math.min(1, Math.max(0, t)) ** (1 / 2.2));
}

/** Linear light leaving a surface with world-space normal n, lit by a small studio. */
export function radiance(m: Material, nx: number, ny: number, nz: number): V3 {
  const key = Math.max(0, (nx * KEY[0] + ny * KEY[1] + nz * KEY[2] + 0.12) / 1.12);
  const fill = Math.max(0, nx * FILL[0] + ny * FILL[1] + nz * FILL[2]);
  const sky = 0.5 - 0.5 * ny;
  const ndv = Math.max(0, nz);
  const fresnel = m.f0 + (1 - m.f0) * (1 - ndv) ** 5;
  const env = environment(2 * ndv * nx, 2 * ndv * ny, 2 * ndv * nz - 1) * fresnel;
  const spec = m.spec * Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) ** m.shininess;
  const back = Math.max(0, nx * BACK[0] + ny * BACK[1] + nz * BACK[2]);
  const rim = m.rim * back * back * (1 - ndv) ** 1.6;
  const diffuse = 0.18 + 0.16 * sky + 1.1 * key + 0.2 * fill;
  const channel = (a: number, rimTint: number) =>
    a * diffuse * (1 - fresnel * 0.6) + env + spec + rim * rimTint * (0.35 + a);
  return [channel(m.albedo[0], 0.62), channel(m.albedo[1], 0.78), channel(m.albedo[2], 1)];
}

export function css(c: V3): string {
  return `rgb(${display(c[0])},${display(c[1])},${display(c[2])})`;
}
