/** The bolt on the app icon's screen, one character per LED. */
export const BOLT = [
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
] as const;

export const BOLT_CELLS: ReadonlyArray<readonly [column: number, row: number]> = BOLT.flatMap(
  (row, r) => Array.from(row).flatMap((cell, c) => (cell === "#" ? [[c, r] as const] : [])),
);

export const hash = (x: number, y: number) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** A thinking LED idles dim and sparks at its own pace, `t` seconds in. */
export const thinkingLevel = (column: number, row: number, t: number) => {
  const spark =
    Math.max(0, Math.sin(t * (1.5 + hash(row, column) * 2.5) + hash(column, row) * 6.28)) ** 12;
  return 0.22 + 0.78 * spark;
};
