import type { Diagram } from "@supaterm/mermaid/diagram";
import { act, render as renderUi, stubGlobal, type Screen } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("./mermaidRenderer"), async (original) => ({
  ...(await original()),
  renderMermaidDiagram: vi.fn(),
}));

import { MermaidBlock } from "./MermaidBlock";
import { renderMermaidDiagram } from "./mermaidRenderer";
import { observeResize } from "../lib/observeResize";

vi.mock("../lib/observeResize", () => ({ observeResize: vi.fn(() => () => {}) }));

// Visibility is reported by hand so each case decides when the fence scrolls into view.
class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(private readonly report: (entries: Array<{ isIntersecting: boolean }>) => void) {
    TestIntersectionObserver.instances.push(this);
  }

  visible(value: boolean) {
    this.report([{ isIntersecting: value }]);
  }
}

const diagram = (text: string): Diagram => ({
  svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${text}</text></svg>`,
  width: 100,
  height: 100,
  type: "flowchart",
});

let screen: Screen;

async function setupTest() {
  await using resources = new AsyncDisposableStack();
  resources.defer(() => {
    vi.restoreAllMocks();
  });

  TestIntersectionObserver.instances = [];
  resources.use(stubGlobal("IntersectionObserver", TestIntersectionObserver));
  vi.mocked(renderMermaidDiagram).mockReset();
  vi.mocked(observeResize).mockClear();
  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

function block(source: string, complete = true, title: string | null = null) {
  return <MermaidBlock source={source} complete={complete} title={title} />;
}

async function mount(source: string, complete = true) {
  await screen.rerender(block(source, complete));
}

function displayedText() {
  return (screen.container.querySelector("code") ?? screen.container.querySelector("svg text"))!
    .textContent;
}

function button(label: string) {
  const found = [...screen.container.querySelectorAll("button")].find(
    (item) => item.textContent === label || item.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

const press = (label: string) => act(async () => button(label).click());

function deferredResult() {
  let resolve!: (value: Diagram | null) => void;
  const promise = new Promise<Diagram | null>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("MermaidBlock", () => {
  it("keeps a working diagram when resizing fails and replaces it after recovery", async () => {
    await using _test = await setupTest();
    const source = "flowchart LR\nA-->B";
    vi.mocked(renderMermaidDiagram)
      .mockResolvedValueOnce(diagram("wide diagram"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(diagram("narrow diagram"))
      .mockResolvedValueOnce(null);
    await mount(source);
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    const blockElement = screen.container.firstElementChild!;
    const measure = vi
      .mocked(observeResize)
      .mock.calls.find(([element]) => element === blockElement)![1];
    const width = vi.spyOn(blockElement, "clientWidth", "get");
    await act(async () => {
      width.mockReturnValue(320);
      measure([]);
    });
    expect(displayedText()).toBe("wide diagram");
    await act(async () => {
      width.mockReturnValue(240);
      measure([]);
    });
    expect(displayedText()).toBe("narrow diagram");
    await screen.rerender(block("invalid replacement"));
    expect(displayedText()).toBe("invalid replacement");
  });

  it("renders only a completed, visible fence", async () => {
    await using _test = await setupTest();
    vi.mocked(renderMermaidDiagram).mockResolvedValue(diagram("diagram"));
    await mount("graph TD\n A-->B", false);
    expect(displayedText()).toBe("graph TD\n A-->B");
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
    await screen.rerender(block("graph TD\n A-->B"));
    expect(displayedText()).toBe("diagram");
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
  });

  it("strips active content from rendered diagrams and keeps their accessible name", async () => {
    await using _test = await setupTest();
    vi.mocked(renderMermaidDiagram).mockResolvedValue({
      ...diagram("label"),
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="d-title" onload="alert(1)">',
        '<title id="d-title">Build</title><style>text{fill:red}</style>',
        '<a href="https://example.com"><text>link</text></a>',
        '<image href="https://example.com/x.png"/>',
        "<foreignObject><div>html</div></foreignObject>",
        '<text style="fill:var(--pele-fg)">label</text></svg>',
      ].join(""),
    });
    await mount("graph TD\n A");
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    const svg = screen.container.querySelector("svg text")!.closest("svg")!;
    expect(svg.outerHTML).not.toMatch(
      /<a\b|<image\b|<foreignObject\b|<style\b|onload|example\.com/i,
    );
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-labelledby")).toBe(svg.querySelector("title")!.id);
    expect([...svg.querySelectorAll("text")].map((text) => text.textContent)).toEqual([
      "link",
      "label",
    ]);
    expect(svg.querySelector("text:last-of-type")!.getAttribute("style")).toBe(
      "fill:var(--pele-fg)",
    );
  });

  it("preserves source until visible and copies Mermaid source from either view", async () => {
    await using _test = await setupTest();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockImplementation(async () => undefined);
    vi.mocked(renderMermaidDiagram).mockResolvedValue(diagram("┌───┐\n│ A │\n└───┘"));
    await mount("graph TD\n A");
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    expect(displayedText()).toBe("┌───┐\n│ A │\n└───┘");
    await press("Copy Mermaid source");
    expect(writeText).toHaveBeenLastCalledWith("graph TD\n A");
    await press("Source");
    expect(displayedText()).toBe("graph TD\n A");
    await press("Copied");
    expect(writeText).toHaveBeenLastCalledWith("graph TD\n A");
    await press("Diagram");
    expect(displayedText()).toBe("┌───┐\n│ A │\n└───┘");
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
  });

  it("opens the rendered diagram full screen from either view", async () => {
    await using _test = await setupTest();
    vi.mocked(renderMermaidDiagram).mockResolvedValue(diagram("┌───┐\n│ A │\n└───┘"));
    await mount("graph TD\n A");
    expect(() => button("Open full screen")).toThrow();
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    await press("Source");
    await press("Open full screen");
    const expanded = document.querySelector('[role="dialog"]')!;
    expect(expanded.querySelector("svg text")!.textContent).toBe("┌───┐\n│ A │\n└───┘");
  });

  it("keeps original source after failure without retrying on ordinary rerenders", async () => {
    await using _test = await setupTest();
    vi.mocked(renderMermaidDiagram).mockResolvedValue(null);
    await mount("unsupported");
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    await screen.rerender(block("unsupported", true, "Example"));
    expect(displayedText()).toBe("unsupported");
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
  });

  it("copies diagrams on remote HTTP pages without the Clipboard API", async () => {
    await using _test = await setupTest();
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as never);
    let copiedText: string | undefined;
    const execCommand = vi.spyOn(document, "execCommand").mockImplementation(() => {
      copiedText = (document.activeElement as HTMLTextAreaElement | null)?.value;
      return true;
    });
    vi.mocked(renderMermaidDiagram).mockResolvedValue(diagram("diagram"));
    await mount("graph TD\n A");
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    await press("Copy Mermaid source");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copiedText).toBe("graph TD\n A");
    expect(button("Copied")).toBeDefined();
  });

  it("ignores a result for an outdated source", async () => {
    await using _test = await setupTest();
    const first = deferredResult();
    const second = deferredResult();
    vi.mocked(renderMermaidDiagram)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await mount("first");
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    await screen.rerender(block("second"));
    await act(async () => first.resolve(diagram("stale diagram")));
    expect(displayedText()).toBe("second");
    await act(async () => second.resolve(diagram("second diagram")));
    expect(displayedText()).toBe("second diagram");
  });
});
