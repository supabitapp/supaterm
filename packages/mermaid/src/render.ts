import { render } from "pele";
import {
  acceptsDiagramSource,
  diagramOptions,
  DIAGRAM_LIMITS,
  isDiagram,
  type DiagramOptions,
} from "./diagram.ts";

export function renderDiagram(source: string, options: DiagramOptions = {}) {
  if (!acceptsDiagramSource(source)) return null;
  try {
    const result = render(source, {
      ...diagramOptions(options),
      directionBreakpoint: 960,
      links: false,
      images: false,
      limit: DIAGRAM_LIMITS.sourceChars,
      outputLimit: DIAGRAM_LIMITS.svgChars,
      maxEdges: DIAGRAM_LIMITS.edges,
      idPrefix: "supaterm-diagram",
    });
    if (!isDiagram(result)) return null;
    return { svg: result.svg, width: result.width, height: result.height, type: result.type };
  } catch {
    return null;
  }
}
