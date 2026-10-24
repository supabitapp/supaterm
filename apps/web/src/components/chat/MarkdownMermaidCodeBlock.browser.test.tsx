import type { Diagram } from "@supaterm/mermaid/diagram";
import { act, render as renderUi, stubGlobal, type Screen } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("../../diagrams/mermaidRenderer"), async (original) => ({
  ...(await original()),
  renderMermaidDiagram: vi.fn(),
  peekMermaidDiagram: vi.fn(),
}));
vi.mock("../../lib/observeResize", () => ({ observeResize: vi.fn(() => () => {}) }));

import { MarkdownMermaidCodeBlock } from "./MarkdownMermaidCodeBlock";
import { peekMermaidDiagram, renderMermaidDiagram } from "../../diagrams/mermaidRenderer";
import { observeResize } from "../../lib/observeResize";

// Visibility is reported by hand so each case decides when the fence scrolls into view.
class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(private readonly report: (entries: Array<{ isIntersecting: boolean }>) => void) {
    TestIntersectionObserver.instances.push(this);
  }

  visible() {
    this.report([{ isIntersecting: true }]);
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
  // Tests run without the app stylesheet, so the diagram's flex container would measure 0 px.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  vi.mocked(renderMermaidDiagram).mockReset();
  vi.mocked(peekMermaidDiagram).mockReset();
  vi.mocked(observeResize).mockClear();
  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

function block(code: string, isStreaming = false) {
  return (
    <MarkdownMermaidCodeBlock
      code={code}
      fenceTitle={null}
      theme="light"
      isStreaming={isStreaming}
      onExpand={() => {}}
    >
      <pre>
        <code>{code}</code>
      </pre>
    </MarkdownMermaidCodeBlock>
  );
}

const showVisible = () => act(async () => TestIntersectionObserver.instances.at(-1)!.visible());

function displayedText() {
  return (screen.container.querySelector("svg text") ?? screen.container.querySelector("code"))!
    .textContent;
}

function press(label: string) {
  const found = [...screen.container.querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return act(async () => found.click());
}

function deferredResult() {
  let resolve!: (value: Diagram | null) => void;
  const promise = new Promise<Diagram | null>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("MarkdownMermaidCodeBlock", () => {
  it("renders the diagram only once the fence is complete and visible", async () => {
    await using _test = await setupTest();
    vi.mocked(renderMermaidDiagram).mockResolvedValue(diagram("diagram"));
    await screen.rerender(block("graph TD\n A-->B", true));
    expect(displayedText()).toBe("graph TD\n A-->B");
    await screen.rerender(block("graph TD\n A-->B"));
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
    await showVisible();
    expect(displayedText()).toBe("diagram");
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
  });

  it("keeps a working diagram when a resize fails and replaces it after recovery", async () => {
    await using _test = await setupTest();
    vi.mocked(renderMermaidDiagram)
      .mockResolvedValueOnce(diagram("wide diagram"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(diagram("narrow diagram"));
    await screen.rerender(block("flowchart LR\nA-->B"));
    await showVisible();
    expect(displayedText()).toBe("wide diagram");
    const [element, measure] = vi.mocked(observeResize).mock.calls.at(-1)!;
    const width = vi.spyOn(element as HTMLElement, "clientWidth", "get");
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
  });

  it("ignores a result for an outdated source", async () => {
    await using _test = await setupTest();
    const first = deferredResult();
    const second = deferredResult();
    vi.mocked(renderMermaidDiagram)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await screen.rerender(block("first"));
    await showVisible();
    await screen.rerender(block("second"));
    await showVisible();
    await act(async () => first.resolve(diagram("stale diagram")));
    expect(screen.container.querySelector("svg text")).toBeNull();
    await act(async () => second.resolve(diagram("second diagram")));
    expect(displayedText()).toBe("second diagram");
  });

  it("shows the source with an error when the diagram cannot be rendered", async () => {
    await using _test = await setupTest();
    vi.mocked(renderMermaidDiagram).mockResolvedValue(null);
    await screen.rerender(block("unsupported"));
    await showVisible();
    expect(screen.container.textContent).toContain("Unable to render diagram");
    expect(screen.container.querySelector("pre")!.textContent).toBe("unsupported");
  });

  it("switches between the diagram and its code, redrawing a finished diagram at once", async () => {
    await using _test = await setupTest();
    vi.mocked(renderMermaidDiagram).mockResolvedValue(diagram("diagram"));
    await screen.rerender(block("graph TD\n A"));
    await showVisible();
    await press("Show code");
    expect(displayedText()).toBe("graph TD\n A");
    vi.mocked(peekMermaidDiagram).mockReturnValue(diagram("diagram"));
    await press("Show diagram");
    expect(displayedText()).toBe("diagram");
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
  });
});
