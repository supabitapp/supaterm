import { renderDiagram } from "@supaterm/mermaid";
import type { DiagramOptions } from "@supaterm/mermaid/diagram";

self.addEventListener(
  "message",
  (event: MessageEvent<{ source: string; options: DiagramOptions }>) => {
    const output = renderDiagram(event.data.source, event.data.options);
    self.postMessage(output ? { output } : { error: true }, { transfer: [] });
  },
);

self.postMessage({ ready: true }, { transfer: [] });
