import { diagramInstanceSvg, diagramOptions, type Diagram } from "@supaterm/mermaid/diagram";
import DOMPurify from "dompurify";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { observeResize } from "../lib/observeResize";
import { renderMermaidDiagram } from "./mermaidRenderer";

const theme = {
  "--pele-bg": "var(--background)",
  "--pele-fg": "var(--contrast-foreground)",
  "--pele-muted": "var(--contrast-muted-foreground)",
  "--pele-line": "var(--contrast-muted-foreground)",
  "--pele-surface": "var(--card)",
  "--pele-surface-alt": "var(--secondary)",
  "--pele-border": "var(--border)",
  "--pele-accent": "var(--primary)",
  "--pele-critical": "var(--destructive)",
} as CSSProperties;

let purifier: ReturnType<typeof DOMPurify> | null = null;

// Diagrams can come from untrusted PR descriptions. Pele escapes labels and
// links and images are off, so this is defense in depth against anything that
// could navigate, run script, or fetch remote content.
function sanitizeDiagramSvg(svg: string) {
  purifier ??= DOMPurify(window);
  return purifier.sanitize(svg, {
    // The SVG profile drops role, which names the diagram as one image.
    ADD_ATTR: ["role"],
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["a", "image", "foreignObject", "style"],
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}

export function useDiagramWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(diagramOptions({ maxWidth: element.clientWidth - 24 }).maxWidth);
    measure();
    return observeResize(element, measure);
  }, []);
  return { ref, width };
}

export function useMermaidDiagram(source: string, width: number, enabled: boolean) {
  const [result, setResult] = useState<{ source: string; diagram: Diagram | null } | null>(null);
  useEffect(() => {
    if (!enabled || width === 0) return;
    let current = true;
    void renderMermaidDiagram(source, { maxWidth: width }).then((diagram) => {
      if (current) {
        setResult((previous) =>
          diagram === null && previous?.source === source ? previous : { source, diagram },
        );
      }
    });
    return () => {
      current = false;
    };
  }, [source, width, enabled]);
  return result?.source === source ? result.diagram : null;
}

export function MermaidSvg({ diagram }: { readonly diagram: Diagram }) {
  const id = useId();
  return (
    <div
      style={{ ...theme, width: diagram.width, height: diagram.height }}
      className="shrink-0 [&>svg]:block [&>svg]:max-w-none"
      dangerouslySetInnerHTML={{ __html: sanitizeDiagramSvg(diagramInstanceSvg(diagram, id)) }}
    />
  );
}

export function ExpandedMermaid({ source }: { readonly source: string }) {
  const { ref, width } = useDiagramWidth();
  const diagram = useMermaidDiagram(source, width, true);
  return (
    <div ref={ref} style={{ width: "calc(92vw - 48px)" }}>
      {diagram ? (
        <MermaidSvg diagram={diagram} />
      ) : (
        <pre className="whitespace-pre-wrap">{source}</pre>
      )}
    </div>
  );
}
