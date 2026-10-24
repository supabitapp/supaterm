export const FACE_COLS = 28;
export const FACE_ROWS = 25;

/** The LED matrix: the face area centred in a matrix that covers the whole glass. */
export interface Grid {
  readonly v: Float32Array;
  readonly cols: number;
  readonly rows: number;
  readonly ox: number;
  readonly oy: number;
}

export function makeGrid(cols: number, rows: number): Grid {
  // Grow by even steps so the face area stays on whole cells.
  const c = FACE_COLS + 2 * Math.max(0, Math.ceil((cols - FACE_COLS) / 2));
  const r = FACE_ROWS + 2 * Math.max(0, Math.ceil((rows - FACE_ROWS) / 2));
  return {
    v: new Float32Array(c * r),
    cols: c,
    rows: r,
    ox: (c - FACE_COLS) / 2,
    oy: (r - FACE_ROWS) / 2,
  };
}

const put = (g: Grid, c: number, r: number, v: number) => {
  const x = c + g.ox;
  const y = r + g.oy;
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return;
  const i = y * g.cols + x;
  if (v > (g.v[i] ?? 0)) g.v[i] = v;
};

export const hash = (x: number, y: number) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Slide each row sideways by up to `spread` cells, like a CRT losing sync. */
export function tear(g: Grid, seed: number, spread: number) {
  for (let r = 0; r < g.rows; r++) {
    const shift = Math.floor(hash(r, seed) * (2 * spread + 1)) - spread;
    if (shift === 0) continue;
    const row = g.v.slice(r * g.cols, (r + 1) * g.cols);
    for (let c = 0; c < g.cols; c++) {
      g.v[r * g.cols + c] = row[(c - shift + g.cols) % g.cols] ?? 0;
    }
  }
}

// The bolt from the app icon's screen.
const BOLT = [
  "......#######.",
  ".....#########",
  "....##########",
  "...###########",
  "...##########.",
  "..##########..",
  "..#########...",
  ".#########....",
  ".#########....",
  "#############.",
  "##############",
  "##############",
  "#############.",
  ".###########..",
  ".....######...",
  "....#######...",
  "....######....",
  "....#####.....",
  "...#####......",
  "...####.......",
  "...###........",
  "...##.........",
  "...#..........",
];
const BOLT_X = 7;
const BOLT_Y = 1;
const BOLT_CELLS = BOLT.flatMap((row, r) =>
  Array.from(row).flatMap((cell, c) => (cell === "#" ? [[c, r] as const] : [])),
);

export function drawBolt(g: Grid) {
  for (const [c, r] of BOLT_CELLS) put(g, BOLT_X + c, BOLT_Y + r, 1);
}

const SPARKLES = [
  [2, 3, 0],
  [24, 5, 0.35],
  [3, 18, 0.6],
  [23, 19, 0.15],
] as const;

/** Sparkles popping round the bolt, `t` seconds in, at `level` brightness. */
export function drawSparkles(g: Grid, t: number, level: number) {
  for (const [c, r, delay] of SPARKLES) {
    const v = Math.sin(((t * 1.8 + delay) % 1) * Math.PI) * level;
    put(g, c, r, v);
    if (v > 0.5) {
      put(g, c - 1, r, v * 0.5);
      put(g, c + 1, r, v * 0.5);
      put(g, c, r - 1, v * 0.5);
      put(g, c, r + 1, v * 0.5);
    }
  }
}
