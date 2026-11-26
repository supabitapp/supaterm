/* oxlint-disable react/no-array-index-key -- Notebook cells and outputs retain their saved source order. */
import { formatAttachmentSize } from "@supaterm/client-runtime/state/attachments";
import { useEffect, useRef, useState } from "react";
import type { Root, RootContent } from "mdast";
import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import ReadOnlySourcePreview from "./ReadOnlySourcePreview";
import DocumentPages from "./DocumentPages";
import { FileSurfaceNotice } from "./fileSurfaceChrome";
import type { OfficeWorkerResult } from "./officePreviewProtocol";
import { T, useGT } from "gt-react";

// Saved notebooks must not load URLs or turn authored links into app actions.
function inertNotebookMarkdown() {
  function clean(nodes: RootContent[]): RootContent[] {
    return nodes.flatMap((node): RootContent[] => {
      if (node.type === "html" || node.type === "definition") return [];
      if (node.type === "image" || node.type === "imageReference")
        return [{ type: "text", value: node.alt ?? "" }];
      if (node.type === "link" || node.type === "linkReference") return clean(node.children);
      if (node.type === "inlineCode") return [{ type: "text", value: node.value }];
      if (node.type === "code" && node.lang === "mermaid") return [{ ...node, lang: "text" }];
      if ("children" in node) node.children = clean(node.children) as typeof node.children;
      return [node];
    });
  }
  return (tree: Root) => {
    tree.children = clean(tree.children) as Root["children"];
  };
}
const NOTEBOOK_PLUGINS = [inertNotebookMarkdown];

function NotebookSource(props: { readonly name: string; readonly text: string }) {
  const [height, setHeight] = useState(() =>
    Math.min(360, props.text.split("\n").length * 20 + 16),
  );
  const measure = (node: HTMLElement) => {
    setHeight(Math.min(360, Math.ceil(node.getBoundingClientRect().height)));
  };
  return (
    <div className="flex min-h-0 flex-col" style={{ height }}>
      <ReadOnlySourcePreview {...props} onPostRender={measure} />
    </div>
  );
}

export default function NotebookPreview(props: {
  readonly notebook: Extract<OfficeWorkerResult, { type: "notebook" }>;
  readonly sizeBytes?: number | undefined;
}) {
  const gt = useGT();
  const [visible, setVisible] = useState(20);
  const scroll = useRef<HTMLDivElement>(null);
  const [outputView, setOutputView] = useState(() => ({
    mounted: new Set<string>(),
    heights: new Map<string, number>(),
  }));
  const outputCount = props.notebook.cells
    .slice(0, visible)
    .reduce(
      (count, cell) => count + cell.outputs.filter((output) => output.kind === "html").length,
      0,
    );
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Observe output visibility and measure departing outputs to bound iframe lifetimes while preserving scroll height.
  useEffect(() => {
    const root = scroll.current;
    if (!root || !outputCount) return;
    const inView = new Set<Element>();
    const nearby = new Set<Element>();
    let active = new Set<Element>();
    const outputKey = (node: Element) => node.getAttribute("data-notebook-output")!;
    const track = (candidates: Set<Element>) => (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (entry.isIntersecting) candidates.add(entry.target);
        else candidates.delete(entry.target);
      }
      // Mount every visible output. Only preload while the total is below 16.
      const next = new Set(inView);
      for (const node of nearby) {
        if (next.size >= 16) break;
        next.add(node);
      }
      const departing = [...active].filter((node) => !next.has(node));
      if (active.size === next.size && departing.length === 0) return;
      const measured = departing.flatMap((node) => {
        const height = node.clientHeight;
        return height > 0 ? [[outputKey(node), height] as const] : [];
      });
      active = next;
      setOutputView((old) => ({
        mounted: new Set(Array.from(next, outputKey)),
        heights: new Map([...old.heights, ...measured]),
      }));
    };
    const viewportObserver = new IntersectionObserver(track(inView), { root });
    const preloadObserver = new IntersectionObserver(track(nearby), { root, rootMargin: "160px" });
    for (const node of root.querySelectorAll("[data-notebook-output]")) {
      viewportObserver.observe(node);
      preloadObserver.observe(node);
    }
    return () => {
      viewportObserver.disconnect();
      preloadObserver.disconnect();
    };
  }, [outputCount]);
  return (
    <>
      <div
        className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground tabular-nums"
        role="status"
      >
        {props.notebook.cells.length.toLocaleString()}{" "}
        {props.notebook.cells.length === 1 ? "cell" : "cells"} · {props.notebook.language}
        {props.sizeBytes !== undefined
          ? ` · ${props.sizeBytes === 0 ? "0 bytes" : formatAttachmentSize(props.sizeBytes)}`
          : ""}
      </div>
      <FileSurfaceNotice>
        <T>Saved outputs only. Code is never executed.</T>
      </FileSurfaceNotice>
      <div ref={scroll} className="scrollbar-gutter-both min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-5 px-5 py-6">
          {props.notebook.cells.slice(0, visible).map((cell, index) => (
            <section
              key={index}
              aria-label={gt("Cell {number}", { number: index + 1 })}
              className="min-w-0 overflow-hidden rounded-md border border-border/60"
            >
              <div className="border-b border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                {cell.kind === "code" ? props.notebook.language : cell.kind} · {index + 1}
              </div>
              {cell.kind === "markdown" ? (
                <ChatMarkdown
                  text={cell.source}
                  cwd={undefined}
                  parseRawHtml={false}
                  extraRemarkPlugins={NOTEBOOK_PLUGINS}
                  className="px-4 py-3"
                />
              ) : cell.source.trim() ? (
                <NotebookSource
                  name={`cell.${cell.kind === "code" ? (({ python: "py", javascript: "js", typescript: "ts", julia: "jl" } as Record<string, string>)[props.notebook.language] ?? props.notebook.language) : "txt"}`}
                  text={cell.source}
                />
              ) : null}
              {cell.outputs.map((output, outputIndex) => {
                const key = `${index}-${outputIndex}`;
                const mounted = outputView.mounted.has(key);
                const estimatedHeight = outputView.heights.get(key) ?? 80;
                return (
                  <div
                    key={outputIndex}
                    data-notebook-output={output.kind === "html" ? key : undefined}
                    className="box-content border-t border-border/60"
                    style={{
                      minHeight: output.kind === "html" && !mounted ? estimatedHeight : undefined,
                    }}
                  >
                    {output.kind === "html" ? (
                      mounted ? (
                        <DocumentPages
                          html={output.text}
                          name={`Cell ${index + 1} HTML output`}
                          output
                          estimatedOutputHeight={estimatedHeight}
                        />
                      ) : null
                    ) : output.kind === "image" ? (
                      <img
                        src={output.text}
                        alt={gt("Cell {number} output", { number: index + 1 })}
                        loading="lazy"
                        className="max-h-96 max-w-full p-4 object-contain"
                      />
                    ) : (
                      <pre className="overflow-x-auto p-4 text-xs whitespace-pre-wrap break-words">
                        {output.text}
                      </pre>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
          {props.notebook.cells.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <T>This notebook is empty.</T>
            </p>
          ) : null}
          {visible < props.notebook.cells.length ? (
            <Button variant="outline" size="sm" onClick={() => setVisible((count) => count + 20)}>
              Show more cells ({props.notebook.cells.length - visible} remaining)
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
