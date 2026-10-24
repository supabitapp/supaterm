import { createDiagramRenderer } from "@supaterm/client-runtime/diagram-rendering";
import {
  DIAGRAM_LIMITS,
  isDiagram,
  type Diagram,
  type MathMarkup,
  type MathResolver,
} from "@supaterm/mermaid/diagram";
import { mathLabelKey, type DiagramWorkerRequest, type MathLabel } from "./mermaidWorkerProtocol";

const MAX_MEASURED_LABELS = 512;
// The first pass reports labels the main thread has not measured and the second draws them. A
// third covers a re-layout that asks for a label at another size.
const MAX_MATH_PASSES = 3;

interface WorkerReply {
  readonly output: Diagram;
  readonly misses: ReadonlyArray<MathLabel>;
}

type MeasuredLabels = Map<string, { readonly tex: string; readonly markup: MathMarkup | null }>;

function isMathLabel(value: unknown): value is MathLabel {
  return (
    typeof value === "object" &&
    value !== null &&
    "tex" in value &&
    typeof value.tex === "string" &&
    "size" in value &&
    typeof value.size === "number"
  );
}

export function createBrowserDiagramRenderer() {
  let worker: Worker | undefined;
  let ready = false;
  // Measuring MathML needs the DOM, so math labels are typeset here and laid out in the worker.
  const measuredBy = new WeakMap<MathResolver, MeasuredLabels>();

  const post = (request: DiagramWorkerRequest) =>
    new Promise<WorkerReply | null>((resolve, reject) => {
      const activeWorker = (worker ??= new Worker(new URL("./mermaid.worker.ts", import.meta.url), {
        type: "module",
      }));
      let settled = false;
      let sent = false;
      const finish = (output: WorkerReply | null, terminate = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeWorker.removeEventListener("message", handleMessage);
        activeWorker.removeEventListener("error", handleError);
        activeWorker.removeEventListener("messageerror", handleMessageError);
        if (terminate) {
          activeWorker.terminate();
          worker = undefined;
          ready = false;
          reject(new Error("Diagram preview unavailable"));
        } else {
          resolve(output);
        }
      };
      let timer = setTimeout(() => finish(null, true), 15_000);
      const send = () => {
        if (sent) return;
        sent = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish(null, true), DIAGRAM_LIMITS.durationMs * 2);
        try {
          activeWorker.postMessage(request, []);
        } catch {
          finish(null, true);
        }
      };
      const handleMessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (typeof data !== "object" || data === null) {
          finish(null, true);
          return;
        }
        if (!sent) {
          if (!("ready" in data) || data.ready !== true) {
            finish(null, true);
            return;
          }
          ready = true;
          send();
        } else if ("output" in data && isDiagram(data.output)) {
          const misses = "misses" in data && Array.isArray(data.misses) ? data.misses : [];
          finish({ output: data.output, misses: misses.filter(isMathLabel) });
        } else if ("error" in data && data.error === true) {
          finish(null);
        } else {
          finish(null, true);
        }
      };
      const handleError = (event: ErrorEvent) => {
        event.preventDefault();
        finish(null, true);
      };
      const handleMessageError = () => finish(null, true);
      activeWorker.addEventListener("message", handleMessage);
      activeWorker.addEventListener("error", handleError);
      activeWorker.addEventListener("messageerror", handleMessageError);
      if (ready) send();
    });

  const measure = (resolver: MathResolver, measured: MeasuredLabels, label: MathLabel) => {
    const key = mathLabelKey(label);
    let entry = measured.get(key);
    if (!entry) {
      if (measured.size >= MAX_MEASURED_LABELS) measured.delete(measured.keys().next().value!);
      entry = { tex: label.tex, markup: resolver(label.tex, label.size) ?? null };
      measured.set(key, entry);
    }
    return [key, entry.markup] as const;
  };

  return createDiagramRenderer(async (source, options, resolver) => {
    if (!resolver || !source.includes("$$"))
      return (await post({ source, options }))?.output ?? null;
    let measured = measuredBy.get(resolver);
    if (!measured) {
      measured = new Map();
      measuredBy.set(resolver, measured);
    }
    const math = new Map<string, MathMarkup | null>();
    for (const [key, entry] of measured) {
      if (source.includes(entry.tex)) math.set(key, entry.markup);
    }
    for (let pass = 1; ; pass++) {
      const reply = await post({ source, options, math: [...math] });
      if (!reply || reply.misses.length === 0 || pass === MAX_MATH_PASSES) {
        return reply?.output ?? null;
      }
      for (const label of reply.misses) math.set(...measure(resolver, measured, label));
    }
  });
}

const renderer = createBrowserDiagramRenderer();

export const renderMermaidDiagram = renderer.render;
export const peekMermaidDiagram = renderer.peek;
