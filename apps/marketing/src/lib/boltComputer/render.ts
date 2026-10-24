import {
  GLASS,
  PLATE,
  SCREEN,
  bakeScreenBase,
  bakeTextures,
  context2d,
  grainPattern,
  makeCanvas,
  newGrid,
  type Bakes,
} from "./bakes";
import { drawBolt, drawSparkles, hash, tear, type Grid } from "./faces";
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
  trace,
  type Matrix,
  type V3,
} from "./geometry";
import { css, linear, radiance, smooth, type Material } from "./light";
import { POWER_ON, REST_POSE, type BoltComputerSim, type Pose } from "./sim";

const SHELL: Material = {
  albedo: linear([226, 219, 202]),
  f0: 0.04,
  spec: 0.3,
  shininess: 40,
  rim: 0.5,
};

const OUTER = extents(HOUSING);

const TRAVEL = { hop: 0.22, overshoot: 0.13, shadow: 0.22, side: 0.17 } as const;
const BOX_INSET = 0.1;

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

const PHOSPHOR = [255, 240, 106] as const;
const LED_COLOR = `rgb(${PHOSPHOR.join(",")})`;
// Each LED's hot centre, a step toward white.
const LED_CORE = `rgb(${PHOSPHOR.map((c) => Math.round(c + (255 - c) * 0.35)).join(",")})`;

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

const FRONT_Z = DEPTH / 2;

/** The pose turned into a projection onto the canvas, in device px. */
interface View {
  readonly R: Matrix;
  readonly U: number;
  readonly cx: number;
  readonly cy: number;
  readonly rest: number;
  readonly project: (x: number, y: number, z: number) => V3;
  /** Set `c`'s transform to draw in the housing's plane at depth `z`. */
  readonly plane: (c: CanvasRenderingContext2D, z: number, flip: boolean) => void;
}

function viewFor(frame: Frame, dpr: number, pose: Pose): View {
  const R = rotation(pose.yaw, pose.pitch, pose.roll);
  const U = frame.unit * dpr;
  const cx = frame.cx * dpr;
  const rest = frame.cy * dpr;
  const cy = rest - pose.lift * U;
  const by = cy + OUTER.hy * U;
  const project = (x: number, y: number, z: number): V3 => {
    const r = rotate(R, x, y, z);
    return [cx + r[0] * U * pose.sx, by + (cy + r[1] * U - by) * pose.sy, r[2]];
  };
  const plane = (c: CanvasRenderingContext2D, z: number, flip: boolean) => {
    const o = project(0, 0, z);
    const ex = project(flip ? -1 : 1, 0, z);
    const ey = project(0, 1, z);
    c.setTransform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
  };
  return { R, U, cx, cy, rest, project, plane };
}

/** The floor's shadow, smaller and fainter the higher the computer hops. */
function drawFloorShadow(ctx: CanvasRenderingContext2D, view: View, pose: Pose) {
  const up = Math.max(0, pose.lift);
  const radius = view.U * OUTER.hx * (1 - up * 0.9) * pose.sx;
  const alpha = 0.55 * Math.max(0, 1 - up * 1.6);
  ctx.save();
  ctx.translate(view.cx, view.rest + (OUTER.hy + 0.11) * view.U);
  ctx.scale(1, 0.16);
  const floor = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  floor.addColorStop(0, `rgba(0,0,0,${alpha})`);
  floor.addColorStop(0.55, `rgba(0,0,0,${alpha * 0.45})`);
  floor.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = floor;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The flat front or back of the housing, shaded as a slight dome. */
function drawPlate(layer: CanvasRenderingContext2D, view: View, facing: number) {
  const dome = 0.17;
  view.plane(layer, facing * FRONT_Z, facing < 0);
  const at = (dx: number, dy: number) => {
    const w = rotate(view.R, dx * facing, dy, facing);
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

function drawSheen(ctx: CanvasRenderingContext2D, pose: Pose) {
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
}

/** Everything that depends on the drawn size. */
interface Sized {
  readonly unit: number;
  readonly bakes: Bakes;
  readonly screen: HTMLCanvasElement;
  /** The screen's phosphor and unlit LEDs, which never change. */
  readonly screenBase: HTMLCanvasElement;
  readonly pitch: number;
  readonly x0: number;
  readonly y0: number;
}

export class BoltComputerRenderer {
  private sized: Sized | null = null;
  private layer: HTMLCanvasElement | null = null;
  private grain: CanvasPattern | null = null;
  private readonly grid: Grid = newGrid();
  private readonly tiny = makeCanvas(this.grid.cols, this.grid.rows);
  private readonly tinyHalf = makeCanvas(this.grid.cols / 2, this.grid.rows / 2);
  private tinyImage: ImageData | null = null;
  private readonly projected = new Float32Array(bodyMesh().pos.length);

  /** Paint a frame; with no sim, the still resting pose. */
  paint(canvas: HTMLCanvasElement, frame: Frame, sim: BoltComputerSim | null) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round((frame.box + 2 * frame.padSide) * dpr);
    const h = Math.round((frame.box + frame.padTop + frame.padBottom) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.draw(context2d(canvas), frame, dpr, sim?.pose ?? REST_POSE, sim);
  }

  private prepare(unit: number): Sized {
    // Textures are drawn scaled to the housing, so they only need rebaking once the size has
    // moved well away from the one they were baked at, not on every frame of a resize.
    if (this.sized && Math.abs(unit / this.sized.unit - 1) < 0.1) return this.sized;
    const screen = makeCanvas(SCREEN.hx * 2 * unit, SCREEN.hy * 2 * unit);
    const pitch = LED_PITCH * unit;
    const x0 = (screen.width - pitch * this.grid.cols) / 2;
    const y0 = (screen.height - pitch * this.grid.rows) / 2;
    this.sized = {
      unit,
      bakes: bakeTextures(unit),
      screen,
      screenBase: bakeScreenBase(screen.width, screen.height, pitch, x0, y0),
      pitch,
      x0,
      y0,
    };
    return this.sized;
  }

  private compose(sim: BoltComputerSim | null): Grid {
    const grid = this.grid;
    const g = grid.v;
    const { cols, rows } = grid;
    g.fill(0);
    drawBolt(grid);
    if (!sim) return grid;
    if (sim.sparkle > 0) drawSparkles(grid, sim.reaction, sim.sparkle);
    if (sim.glitching) {
      const seed = Math.floor(sim.age * 30);
      tear(grid, seed, 1);
      for (let i = 0; i < g.length; i++) {
        if (hash(i, seed) > 0.96) g[i] = Math.max(g[i] ?? 0, 0.3);
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

  private drawScreen(sized: Sized, grid: Grid) {
    const ctx = context2d(sized.screen);
    const { cols, rows, v: g } = grid;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(sized.screenBase, 0, 0);
    const { pitch, x0, y0 } = sized;
    // Bloom first: the matrix at one pixel per LED, scaled up smooth. The cells
    // go over it so they keep the phosphor's colour instead of washing to white.
    const tiny = context2d(this.tiny);
    this.tinyImage ??= tiny.createImageData(cols, rows);
    const d = this.tinyImage.data;
    for (let i = 0; i < cols * rows; i++) {
      d[i * 4] = PHOSPHOR[0];
      d[i * 4 + 1] = PHOSPHOR[1];
      d[i * 4 + 2] = PHOSPHOR[2];
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
    const cell = pitch * 0.8;
    const off = (pitch - cell) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = g[r * cols + c] ?? 0;
        if (v < 0.01) continue;
        const x = x0 + c * pitch + off;
        const y = y0 + r * pitch + off;
        ctx.globalAlpha = Math.min(1, v);
        ctx.fillStyle = LED_COLOR;
        ctx.fillRect(x, y, cell, cell);
        ctx.globalAlpha = Math.min(1, v) * 0.5;
        ctx.fillStyle = LED_CORE;
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
  ) {
    const view = viewFor(frame, dpr, pose);
    const sized = this.prepare(view.U);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    drawFloorShadow(ctx, view, pose);
    const frontZ = view.R[8];
    const facing = Math.abs(frontZ) > 0.005 ? Math.sign(frontZ) : 0;
    this.drawHousing(ctx, view, facing);
    ctx.save();
    if (facing > 0) {
      this.drawScreen(sized, this.compose(sim));
      drawFront(ctx, view, pose, sized);
    } else if (facing < 0) {
      view.plane(ctx, -FRONT_Z, true);
      ctx.drawImage(sized.bakes.back, -PLATE.hx, -PLATE.hy, PLATE.hx * 2, PLATE.hy * 2);
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** The housing goes on its own layer so the grain stays on it. */
  private drawHousing(ctx: CanvasRenderingContext2D, view: View, facing: number) {
    const { width, height } = ctx.canvas;
    if (this.layer?.width !== width || this.layer.height !== height) {
      this.layer = makeCanvas(width, height);
      this.grain = grainPattern(ctx);
    }
    const layer = context2d(this.layer);
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.globalCompositeOperation = "source-over";
    layer.clearRect(0, 0, width, height);
    this.drawBody(layer, view);
    if (facing !== 0) drawPlate(layer, view, facing);
    if (this.grain) {
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.globalCompositeOperation = "source-atop";
      this.grain.setTransform(new DOMMatrix().translate(view.cx, view.cy));
      layer.fillStyle = this.grain;
      layer.fillRect(0, 0, width, height);
      layer.globalCompositeOperation = "source-over";
    }
    ctx.drawImage(this.layer, 0, 0);
  }

  private drawBody(ctx: CanvasRenderingContext2D, { R, U, project }: View) {
    const { pos, quads, normals } = bodyMesh();
    const projected = this.projected;
    for (let i = 0; i < pos.length; i += 3) {
      const p = project(pos[i] ?? 0, pos[i + 1] ?? 0, pos[i + 2] ?? 0);
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

/** The bezel, the recessed glass with the LED screen behind it, and the controls. */
function drawFront(ctx: CanvasRenderingContext2D, view: View, pose: Pose, sized: Sized) {
  view.plane(ctx, FRONT_Z, false);
  ctx.beginPath();
  trace(ctx, SCREEN_HOLE);
  ctx.fillStyle = "#0a0d0b";
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  trace(ctx, SCREEN_HOLE, GASKET);
  ctx.clip();
  // The glass sits behind the bezel, so it slides against it as the computer turns.
  view.plane(ctx, FRONT_Z - RECESS, false);
  ctx.drawImage(sized.screen, -SCREEN.hx, SCREEN_HOLE.cy - SCREEN.hy, SCREEN.hx * 2, SCREEN.hy * 2);
  view.plane(ctx, FRONT_Z, false);
  drawSheen(ctx, pose);
  ctx.restore();
  ctx.drawImage(sized.bakes.front, -PLATE.hx, -PLATE.hy, PLATE.hx * 2, PLATE.hy * 2);
  drawControls(ctx);
}
