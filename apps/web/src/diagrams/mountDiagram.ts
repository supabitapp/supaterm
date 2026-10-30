import {
  diagramInstanceSvg,
  diagramOptions,
  type Diagram,
  type MathResolver,
} from "@supaterm/mermaid/diagram";
import { observeResize } from "../lib/observeResize";
import { peekMermaidDiagram, renderMermaidDiagram } from "./mermaidRenderer";

interface MountDiagramOptions {
  readonly links: false;
  readonly images: false;
  readonly zoom: false;
  readonly autoDirection: boolean;
  readonly math?: MathResolver;
  readonly sanitize: (svg: string) => Node;
  readonly onRender?: () => void;
  readonly onError?: (error: unknown) => void;
}

let mounts = 0;

/** Reuses cached layout while a bounded worker renders visible diagrams at their current width. */
export function mountDiagram(element: HTMLElement, source: string, options: MountDiagramOptions) {
  const id = `mermaid-${++mounts}`;
  let destroyed = false;
  let drawn: Diagram | null = null;
  let requestedWidth = 0;
  let stopResize: (() => void) | undefined;

  const layoutWidth = () => {
    const style = getComputedStyle(element);
    const available =
      element.clientWidth -
      (parseFloat(style.paddingLeft) || 0) -
      (parseFloat(style.paddingRight) || 0);
    return available > 0 ? diagramOptions({ maxWidth: available }).maxWidth : 0;
  };
  const layout = (width: number) => ({ maxWidth: width, autoDirection: options.autoDirection });

  const show = (diagram: Diagram) => {
    drawn = diagram;
    element.replaceChildren(options.sanitize(diagramInstanceSvg(diagram, id)));
    options.onRender?.();
  };

  const draw = () => {
    const width = layoutWidth();
    if (destroyed || width === 0 || width === requestedWidth) return;
    requestedWidth = width;
    void renderMermaidDiagram(source, layout(width), options.math).then((diagram) => {
      if (destroyed || width !== requestedWidth) return;
      if (diagram) show(diagram);
      else if (!drawn) options.onError?.(new Error("The diagram could not be rendered."));
    });
  };

  const start = () => {
    stopResize = observeResize(element, draw);
    draw();
  };

  const initialWidth = layoutWidth();
  const ready =
    initialWidth > 0 ? peekMermaidDiagram(source, layout(initialWidth), options.math) : undefined;
  if (ready) {
    requestedWidth = initialWidth;
    show(ready);
  } else {
    // Also replaces a previous source's diagram, which must not stay up while this one lays out.
    const placeholder = element.ownerDocument.createElement("pre");
    placeholder.className = "m-0 w-full overflow-x-auto text-left font-mono whitespace-pre";
    placeholder.textContent = source;
    element.replaceChildren(placeholder);
  }

  const visibility =
    ready || typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          visibility?.disconnect();
          start();
        });
  if (visibility) visibility.observe(element);
  else start();

  return {
    destroy() {
      destroyed = true;
      visibility?.disconnect();
      stopResize?.();
    },
  };
}
