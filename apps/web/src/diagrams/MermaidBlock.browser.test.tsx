import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("./mermaidRenderer"), async (original) => ({
  ...(await original()),
  renderMermaidDiagram: vi.fn(),
}));

import { MermaidBlock } from "./MermaidBlock";
import { renderMermaidDiagram } from "./mermaidRenderer";

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

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  TestIntersectionObserver.instances = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  vi.mocked(renderMermaidDiagram).mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function block(source: string, complete = true, title: string | null = null) {
  return <MermaidBlock source={source} complete={complete} title={title} />;
}

async function mount(source: string, complete = true) {
  await act(async () => root.render(block(source, complete)));
}

function displayedText() {
  return container.querySelector("code")!.textContent;
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label || item.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

const press = (label: string) => act(async () => button(label).click());

function deferredResult() {
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("MermaidBlock", () => {
  it("renders only a completed, visible fence", async () => {
    vi.mocked(renderMermaidDiagram).mockResolvedValue("diagram");
    await mount("graph TD\n A-->B", false);
    expect(displayedText()).toBe("graph TD\n A-->B");
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
    await act(async () => root.render(block("graph TD\n A-->B")));
    expect(displayedText()).toBe("diagram");
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
  });

  it("preserves source until visible and copies the currently selected representation", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockImplementation(async () => undefined);
    vi.mocked(renderMermaidDiagram).mockResolvedValue("┌───┐\n│ A │\n└───┘");
    await mount("graph TD\n A");
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    expect(displayedText()).toBe("┌───┐\n│ A │\n└───┘");
    await press("Copy diagram");
    expect(writeText).toHaveBeenLastCalledWith("┌───┐\n│ A │\n└───┘");
    await press("Source");
    expect(displayedText()).toBe("graph TD\n A");
    await press("Copy source");
    expect(writeText).toHaveBeenLastCalledWith("graph TD\n A");
    await press("Diagram");
    expect(displayedText()).toBe("┌───┐\n│ A │\n└───┘");
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
  });

  it("opens the rendered diagram full screen from either view", async () => {
    vi.mocked(renderMermaidDiagram).mockResolvedValue("┌───┐\n│ A │\n└───┘");
    await mount("graph TD\n A");
    expect(() => button("Open full screen")).toThrow();
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    await press("Source");
    await press("Open full screen");
    const expanded = document.querySelector('[role="dialog"]')!;
    expect(expanded.querySelector("pre")!.textContent).toBe("┌───┐\n│ A │\n└───┘");
  });

  it("keeps original source after failure without retrying on ordinary rerenders", async () => {
    vi.mocked(renderMermaidDiagram).mockResolvedValue(null);
    await mount("unsupported");
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    await act(async () => root.render(block("unsupported", true, "Example")));
    expect(displayedText()).toBe("unsupported");
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
  });

  it("copies diagrams on remote HTTP pages without the Clipboard API", async () => {
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as never);
    let copiedText: string | undefined;
    const execCommand = vi.spyOn(document, "execCommand").mockImplementation(() => {
      copiedText = (document.activeElement as HTMLTextAreaElement | null)?.value;
      return true;
    });
    vi.mocked(renderMermaidDiagram).mockResolvedValue("diagram");
    await mount("graph TD\n A");
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    await press("Copy diagram");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copiedText).toBe("diagram");
    expect(button("Copied")).toBeDefined();
  });

  it("ignores a result for an outdated source", async () => {
    const first = deferredResult();
    const second = deferredResult();
    vi.mocked(renderMermaidDiagram)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await mount("first");
    await act(async () => TestIntersectionObserver.instances[0]!.visible(true));
    await act(async () => {
      root.render(block("second"));
      first.resolve("stale diagram");
    });
    expect(displayedText()).toBe("second");
    await act(async () => second.resolve("second diagram"));
    expect(displayedText()).toBe("second diagram");
  });
});
