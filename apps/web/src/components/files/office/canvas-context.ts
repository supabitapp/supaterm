/**
 * The painters draw through the members a worker's 2D context shares with the window's. Only the window's context type
 * is declared, and it has focus and attribute members the worker's lacks.
 */
export function asWindowCanvasContext(
  context: OffscreenCanvasRenderingContext2D,
): CanvasRenderingContext2D {
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the vendor painters only declare the window's 2D context.
  return context as unknown as CanvasRenderingContext2D;
}
