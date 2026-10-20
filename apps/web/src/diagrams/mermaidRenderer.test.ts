import { DIAGRAM_LIMITS, diagramOptions } from "@supaterm/mermaid/diagram";

const diagram = (text: string) => ({
  svg: `<svg >${text}</svg>`,
  width: 100,
  height: 100,
  type: "flowchart",
});
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createBrowserDiagramRenderer } from "./mermaidRenderer";

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    super();
    TestWorker.instances.push(this);
  }

  reply(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

beforeEach(() => {
  TestWorker.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("Worker", TestWorker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser diagram rendering", () => {
  it("lazily creates one worker and reuses it for serialized requests", async () => {
    const renderer = createBrowserDiagramRenderer();
    expect(TestWorker.instances).toHaveLength(0);
    const first = renderer.render("first");
    const second = renderer.render("second");
    const worker = TestWorker.instances[0]!;
    expect(worker.postMessage).not.toHaveBeenCalled();
    worker.reply({ ready: true });
    expect(worker.postMessage.mock.calls).toEqual([
      [{ source: "first", options: diagramOptions() }, []],
    ]);
    worker.reply({ output: diagram("first diagram") });
    expect(await first).toEqual(diagram("first diagram"));
    expect(worker.postMessage.mock.calls).toEqual([
      [{ source: "first", options: diagramOptions() }, []],
      [{ source: "second", options: diagramOptions() }, []],
    ]);
    worker.reply({ output: diagram("second diagram") });
    expect(await second).toEqual(diagram("second diagram"));
    expect(TestWorker.instances).toHaveLength(1);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("terminates timed out work, ignores its late reply, and replaces the worker", async () => {
    const renderer = createBrowserDiagramRenderer();
    const first = renderer.render("slow");
    const firstWorker = TestWorker.instances[0]!;
    firstWorker.reply({ ready: true });
    vi.advanceTimersByTime(DIAGRAM_LIMITS.durationMs * 2);
    expect(await first).toBeNull();
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    expect(TestWorker.instances).toHaveLength(1);

    const second = renderer.render("slow");
    firstWorker.reply({ output: diagram("stale diagram") });
    const secondWorker = TestWorker.instances[1]!;
    secondWorker.reply({ ready: true });
    secondWorker.reply({ output: diagram("recovered diagram") });
    expect(await second).toEqual(diagram("recovered diagram"));
  });

  it("retains source on renderer errors without restarting healthy workers", async () => {
    const renderer = createBrowserDiagramRenderer();
    const failed = renderer.render("unsupported");
    const worker = TestWorker.instances[0]!;
    worker.reply({ ready: true });
    worker.reply({ error: true });
    expect(await failed).toBeNull();
    expect(await renderer.render("unsupported")).toBeNull();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("replaces a crashed worker before running queued work", async () => {
    const renderer = createBrowserDiagramRenderer();
    const failed = renderer.render("first");
    const next = renderer.render("second");
    const worker = TestWorker.instances[0]!;
    worker.reply({ ready: true });
    worker.dispatchEvent(new Event("error", { cancelable: true }));
    expect(await failed).toBeNull();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    TestWorker.instances[1]!.reply({ ready: true });
    TestWorker.instances[1]!.reply({ output: diagram("diagram") });
    expect(await next).toEqual(diagram("diagram"));
  });

  it("allows a slow worker download before starting the rendering deadline", async () => {
    const renderer = createBrowserDiagramRenderer();
    const result = renderer.render("first");
    const worker = TestWorker.instances[0]!;
    vi.advanceTimersByTime(10_000);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();
    worker.reply({ ready: true });
    vi.advanceTimersByTime(DIAGRAM_LIMITS.durationMs);
    worker.reply({ output: diagram("diagram") });
    expect(await result).toEqual(diagram("diagram"));
  });

  it("replaces a worker that never becomes ready", async () => {
    const renderer = createBrowserDiagramRenderer();
    const failed = renderer.render("first");
    const worker = TestWorker.instances[0]!;
    vi.advanceTimersByTime(15_000);
    expect(await failed).toBeNull();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
    const next = renderer.render("first");
    TestWorker.instances[1]!.reply({ ready: true });
    TestWorker.instances[1]!.reply({ output: diagram("diagram") });
    expect(await next).toEqual(diagram("diagram"));
  });
});
