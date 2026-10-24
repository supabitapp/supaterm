export const DIAGRAM_LIMITS = {
  sourceChars: 16_384,
  sourceLines: 512,
  lineChars: 2_048,
  edges: 256,
  svgChars: 512 * 1024,
  elements: 8_192,
  dimension: 32_768,
  durationMs: 500,
} as const;

export interface Diagram {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly type: string;
}

export type { MathMarkup, MathResolver } from "pele";

export interface DiagramOptions {
  readonly maxWidth?: number;
  readonly fontFamily?: string;
  readonly fontFamilyMono?: string;
  readonly fontSize?: number;
  readonly now?: number;
  readonly autoDirection?: boolean;
}

export function diagramOptions(options: DiagramOptions = {}) {
  return {
    maxWidth: Math.max(128, Math.min(4096, Math.floor((options.maxWidth || 640) / 32) * 32)),
    fontFamily: options.fontFamily ?? "Arial",
    fontFamilyMono: options.fontFamilyMono ?? "monospace",
    fontSize: Math.max(12, Math.min(24, options.fontSize || 16)),
    // @effect-diagnostics-next-line globalDate:off
    now: options.now ?? Math.floor(Date.now() / 86_400_000) * 86_400_000,
    autoDirection: options.autoDirection ?? true,
  };
}

export function acceptsDiagramSource(source: string) {
  if (!source || source.length > DIAGRAM_LIMITS.sourceChars) return false;
  const lines = source.split("\n");
  return (
    lines.length <= DIAGRAM_LIMITS.sourceLines &&
    lines.every((line) => line.length <= DIAGRAM_LIMITS.lineChars)
  );
}

export function isDiagram(value: unknown): value is Diagram {
  if (typeof value !== "object" || value === null) return false;
  if (
    !("svg" in value) ||
    typeof value.svg !== "string" ||
    !value.svg.startsWith("<svg ") ||
    value.svg.length > DIAGRAM_LIMITS.svgChars ||
    !("type" in value) ||
    typeof value.type !== "string"
  )
    return false;
  return (
    ["width", "height"].every((key) => {
      const dimension = Reflect.get(value, key);
      return (
        typeof dimension === "number" &&
        Number.isFinite(dimension) &&
        dimension > 0 &&
        dimension <= DIAGRAM_LIMITS.dimension
      );
    }) && (value.svg.match(/<[a-z]/g)?.length ?? 0) <= DIAGRAM_LIMITS.elements
  );
}

export function diagramInstanceSvg(diagram: Diagram, id: string) {
  const prefix = `${id.replace(/[^\w-]/g, "")}-`;
  return diagram.svg.replace(/<(?:svg|title|desc)\b[^>]*>/g, (tag) =>
    tag.replace(/((?:id|aria-labelledby|aria-describedby)=")supaterm-diagram-/g, `$1${prefix}`),
  );
}
