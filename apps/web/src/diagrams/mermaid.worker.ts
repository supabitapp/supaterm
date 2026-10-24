import { renderDiagram } from "@supaterm/mermaid";
import { mathLabelKey, type DiagramWorkerRequest, type MathLabel } from "./mermaidWorkerProtocol";

self.addEventListener("message", (event: MessageEvent<DiagramWorkerRequest>) => {
  const { source, options, math } = event.data;
  const measured = math ? new Map(math) : undefined;
  const misses = new Map<string, MathLabel>();
  const output = renderDiagram(
    source,
    options,
    measured &&
      ((tex, size) => {
        const key = mathLabelKey({ tex, size });
        if (measured.has(key)) return measured.get(key);
        misses.set(key, { tex, size });
        return null;
      }),
  );
  self.postMessage(output ? { output, misses: [...misses.values()] } : { error: true }, {
    transfer: [],
  });
});

self.postMessage({ ready: true }, { transfer: [] });
