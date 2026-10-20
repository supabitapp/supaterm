import { DIAGRAM_LIMITS, diagramOptions, type Diagram } from "@supaterm/mermaid/diagram";

const diagram = (text: string): Diagram => ({
  svg: `<svg >${text}</svg>`,
  width: 100,
  height: 100,
  type: "flowchart",
});
import { describe, expect, it, vi } from "vite-plus/test";

import { createDiagramRenderer } from "./diagramRendering.ts";

describe("createDiagramRenderer", () => {
  it("keys geometry by width, fonts and chart date, while coalescing nearby widths", async () => {
    const render = vi.fn(async () => diagram("ready"));
    const renderer = createDiagramRenderer(render);
    await renderer.render("source", { maxWidth: 320, now: 0 });
    await renderer.render("source", { maxWidth: 330, now: 0 });
    expect(render).toHaveBeenCalledTimes(1);
    await renderer.render("source", { maxWidth: 800, now: 0 });
    await renderer.render("source", { maxWidth: 800, fontFamily: "Courier", now: 0 });
    await renderer.render("source", { maxWidth: 800, fontFamily: "Courier", now: 1 });
    expect(render).toHaveBeenCalledTimes(4);
  });
  it("coalesces identical requests and renders different sources in order", async () => {
    const first = Promise.withResolvers<Diagram>();
    const second = Promise.withResolvers<Diagram>();
    const render = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const renderer = createDiagramRenderer(render);
    const firstResult = renderer.render("first");
    const duplicateResult = renderer.render("first");
    const secondResult = renderer.render("second");
    expect(firstResult).toBe(duplicateResult);
    expect(render.mock.calls).toEqual([["first", diagramOptions()]]);
    first.resolve(diagram("first diagram"));
    expect(await firstResult).toEqual(diagram("first diagram"));
    expect(render.mock.calls).toEqual([
      ["first", diagramOptions()],
      ["second", diagramOptions()],
    ]);
    second.resolve(diagram("second diagram"));
    expect(await secondResult).toEqual(diagram("second diagram"));
    expect(await renderer.render("first")).toEqual(diagram("first diagram"));
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("remembers source rejection and continues processing the queue", async () => {
    const render = vi.fn(async (source: string) => {
      if (source === "unsupported") return null;
      return diagram("diagram");
    });
    const renderer = createDiagramRenderer(render);
    const failed = renderer.render("unsupported");
    const good = renderer.render("supported");
    expect(await failed).toBeNull();
    expect(await good).toEqual(diagram("diagram"));
    expect(await renderer.render("unsupported")).toBeNull();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("allows the same source to retry after a transient adapter failure", async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error("Worker unavailable"))
      .mockResolvedValue(diagram("diagram"));
    const renderer = createDiagramRenderer(render);
    expect(await renderer.render("source")).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
    expect(await renderer.render("source")).toEqual(diagram("diagram"));
    expect(await renderer.render("source")).toEqual(diagram("diagram"));
    expect(render.mock.calls).toEqual([
      ["source", diagramOptions()],
      ["source", diagramOptions()],
    ]);
  });

  it("bounds pending work without retaining temporary queue saturation", async () => {
    const first = Promise.withResolvers<Diagram>();
    const render = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(diagram("diagram"));
    const renderer = createDiagramRenderer(render, { maxPending: 1 });
    const firstResult = renderer.render("first");
    expect(await renderer.render("second")).toBeNull();
    expect(renderer.render("first")).toBe(firstResult);
    first.resolve(diagram("first diagram"));
    await firstResult;
    expect(await renderer.render("second")).toEqual(diagram("diagram"));
    expect(render.mock.calls).toEqual([
      ["first", diagramOptions()],
      ["second", diagramOptions()],
    ]);
  });

  it("evicts the least recently read result when the entry limit is reached", async () => {
    const render = vi.fn(async (source: string) => diagram(source));
    const renderer = createDiagramRenderer(render, { maxCacheEntries: 2 });
    await renderer.render("first");
    await renderer.render("second");
    await renderer.render("first");
    await renderer.render("third");
    await renderer.render("first");
    expect(render).toHaveBeenCalledTimes(3);
    await renderer.render("second");
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("counts source keys and results against the cache memory limit", async () => {
    const render = vi.fn(async (source: string) => diagram(source));
    const renderer = createDiagramRenderer(render, {
      maxCacheBytes:
        (JSON.stringify(["aa", diagramOptions()]).length + diagram("aa").svg.length) * 4,
    });
    await renderer.render("aa");
    await renderer.render("bb");
    await renderer.render("cc");
    await renderer.render("bb");
    expect(render).toHaveBeenCalledTimes(3);
    await renderer.render("aa");
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("rejects oversized source before retaining or dispatching it", async () => {
    const render = vi.fn(async () => diagram("diagram"));
    const renderer = createDiagramRenderer(render);
    expect(await renderer.render("x".repeat(DIAGRAM_LIMITS.sourceChars + 1))).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });
});
