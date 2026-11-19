import type { PreviewAnnotationPoint } from "@supaterm/contracts";

export const STROKE_SEGMENTS_PER_PATH = 100;

export interface StrokeGeometry {
  readonly points: PreviewAnnotationPoint[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  openPath: string;
  openSegments: number;
}

export function startStroke(point: PreviewAnnotationPoint) {
  return {
    points: [point],
    minX: point.x,
    minY: point.y,
    maxX: point.x,
    maxY: point.y,
    openPath: `M ${point.x} ${point.y}`,
    openSegments: 0,
  };
}

export function addStrokePoint(geometry: StrokeGeometry, point: PreviewAnnotationPoint) {
  const previous = geometry.points[geometry.points.length - 1]!;
  let closedPath: string | null = null;
  if (geometry.points.length > 1) {
    const midX = (previous.x + point.x) / 2;
    const midY = (previous.y + point.y) / 2;
    geometry.openPath += ` Q ${previous.x} ${previous.y} ${midX} ${midY}`;
    geometry.openSegments += 1;
    if (geometry.openSegments === STROKE_SEGMENTS_PER_PATH) {
      closedPath = geometry.openPath;
      geometry.openPath = `M ${midX} ${midY}`;
      geometry.openSegments = 0;
    }
  }
  geometry.points.push(point);
  geometry.minX = Math.min(geometry.minX, point.x);
  geometry.minY = Math.min(geometry.minY, point.y);
  geometry.maxX = Math.max(geometry.maxX, point.x);
  geometry.maxY = Math.max(geometry.maxY, point.y);
  return closedPath;
}

export function openStrokePath(geometry: StrokeGeometry) {
  const last = geometry.points[geometry.points.length - 1]!;
  return `${geometry.openPath} L ${last.x} ${last.y}`;
}

export function strokeBounds(geometry: StrokeGeometry, width: number) {
  const padding = width + 3;
  const left = geometry.minX - padding;
  const top = geometry.minY - padding;
  const right = geometry.maxX + padding;
  const bottom = geometry.maxY + padding;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
