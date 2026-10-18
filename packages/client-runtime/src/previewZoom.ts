export const PREVIEW_ZOOM = { min: 0.5, max: 2, step: 0.25 } as const;

export function stepPreviewZoom(zoom: number, direction: 1 | -1): number {
  return Math.min(
    PREVIEW_ZOOM.max,
    Math.max(PREVIEW_ZOOM.min, zoom + direction * PREVIEW_ZOOM.step),
  );
}
