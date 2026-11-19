import DOMPurify from "dompurify";
import type { MathResolver } from "@supaterm/mermaid/diagram";
import { use, useState } from "react";

import { mountDiagram } from "../../diagrams/mountDiagram";
import { serializeCodeBlockToMarkdown } from "../../markdown-clipboard";

let mathLoad: Promise<MathResolver | null> | null = null;

function loadMath(): Promise<MathResolver | null> {
  mathLoad ??= import("katex").then(
    ({ default: katex }) => {
      const typeset = new Map<string, ReturnType<MathResolver>>();
      let probe: HTMLDivElement | null = null;
      return (tex, size) => {
        const key = `${size}:${tex}`;
        if (typeset.has(key)) return typeset.get(key);
        let markup: ReturnType<MathResolver> = null;
        try {
          if (!probe) {
            probe = document.createElement("div");
            probe.style.cssText =
              "position:absolute;left:-9999px;visibility:hidden;display:inline-block;white-space:nowrap";
            document.body.append(probe);
          }
          probe.style.fontSize = `${size}px`;
          probe.innerHTML = katex.renderToString(tex, {
            displayMode: true,
            output: "mathml",
            throwOnError: true,
            trust: false,
            strict: "ignore",
            maxSize: 20,
            maxExpand: 1000,
          });
          const expression = probe.querySelector("math");
          expression?.querySelector("annotation")?.remove();
          if (expression) {
            const { width, height } = expression.getBoundingClientRect();
            markup = { html: expression.outerHTML, width, height };
          }
        } catch {}
        typeset.set(key, markup);
        return markup;
      };
    },
    () => null,
  );
  return mathLoad;
}

const KATEX_MATHML_TAGS = new Set([
  "math",
  "menclose",
  "mfrac",
  "mi",
  "mlabeledtr",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mroot",
  "mrow",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
]);
const KATEX_MATHML_ATTRIBUTES = new Set([
  "accent",
  "accentunder",
  "columnalign",
  "columnlines",
  "columnspacing",
  "depth",
  "displaystyle",
  "fence",
  "largeop",
  "linebreak",
  "linethickness",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "notation",
  "rowlines",
  "rowspacing",
  "rspace",
  "scriptlevel",
  "separator",
  "stretchy",
  "voffset",
]);

let purifier: ReturnType<typeof DOMPurify> | null = null;

function sanitizeDiagramSvg(svg: string): Node {
  purifier ??= DOMPurify(window);
  return purifier.sanitize(svg, {
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["a", "image", "foreignObject", "style"],
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM_FRAGMENT: true,
  });
}

function sanitizeMathDiagramSvg(svg: string): Node {
  purifier ??= DOMPurify(window);
  return purifier.sanitize(svg, {
    ADD_TAGS: ["foreignObject", ...KATEX_MATHML_TAGS],
    ADD_ATTR: (attribute, tagName) =>
      KATEX_MATHML_TAGS.has(tagName) && KATEX_MATHML_ATTRIBUTES.has(attribute),
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["a", "img", "image", "script", "style"],
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    RETURN_DOM_FRAGMENT: true,
  });
}

const PELE_COLOR_VARIABLES = [
  "--pele-bg",
  "--pele-fg",
  "--pele-muted",
  "--pele-line",
  "--pele-surface",
  "--pele-surface-alt",
  "--pele-border",
  "--pele-accent",
  "--pele-critical",
  ...Array.from({ length: 8 }, (_, index) => `--pele-series-${index + 1}`),
];

let expandedImageUrl: string | null = null;

function diagramImageUrl(svg: SVGSVGElement): string {
  const element = svg.cloneNode(true) as SVGSVGElement;
  const computed = getComputedStyle(svg);
  for (const name of PELE_COLOR_VARIABLES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) element.style.setProperty(name, value);
  }
  element.style.maxWidth = "none";
  element.style.backgroundColor = getComputedStyle(document.body).backgroundColor;
  if (expandedImageUrl) URL.revokeObjectURL(expandedImageUrl);
  expandedImageUrl = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml" }),
  );
  return expandedImageUrl;
}

export function MermaidDiagram({
  source,
  onExpand,
}: {
  source: string;
  onExpand: (imageUrl: string) => void;
}) {
  const [failure, setFailure] = useState<{ source: string; message: string } | null>(null);
  const trimmedSource = source.trim();
  const renderError = failure?.source === trimmedSource ? failure.message : null;
  const math = trimmedSource.includes("$$") ? use(loadMath()) : null;

  const attachDiagram = (container: HTMLSpanElement) => {
    const mounted = mountDiagram(container, trimmedSource, {
      links: false,
      images: false,
      zoom: false,
      autoDirection: false,
      ...(math ? { math, sanitize: sanitizeMathDiagramSvg } : { sanitize: sanitizeDiagramSvg }),
      onRender: () => setFailure(null),
      onError: (error) =>
        setFailure({
          source: trimmedSource,
          message: error instanceof Error ? error.message : "The diagram could not be rendered.",
        }),
    });
    return () => mounted.destroy();
  };

  return (
    <div
      className="chat-markdown-mermaid overflow-x-auto"
      data-markdown-mermaid=""
      data-markdown-copy={serializeCodeBlockToMarkdown(source, "mermaid")}
    >
      {renderError ? <DiagramError message={renderError} source={source} /> : null}
      <button
        type="button"
        aria-label="Expand diagram"
        hidden={renderError !== null}
        className="block w-full cursor-zoom-in rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        onClick={(event) => {
          const svg = event.currentTarget.querySelector("svg");
          if (svg) onExpand(diagramImageUrl(svg));
        }}
      >
        <span ref={attachDiagram} className="flex w-full justify-center" />
      </button>
    </div>
  );
}

function DiagramError({ message, source }: { message: string; source: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-xs text-destructive">Unable to render diagram: {message}</p>
      </div>
      <pre
        data-thread-find-ignore
        className="mt-2 mb-0 overflow-auto font-mono text-xs whitespace-pre-wrap"
      >
        {source}
      </pre>
    </div>
  );
}
