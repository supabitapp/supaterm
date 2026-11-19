import type { Diagram } from "@supaterm/mermaid/diagram";
import { act, render as renderUi, stubGlobal, type Screen } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";
import "~/index.css";

const mermaid = vi.hoisted(() => {
  const state = {
    queue: [] as Array<Diagram | null | Promise<Diagram | null>>,
    result: null as Diagram | null,
    peeked: undefined as Diagram | undefined,
    renders: 0,
    render: async (..._args: Array<unknown>) => {
      state.renders += 1;
      return state.queue.length > 0 ? state.queue.shift()! : state.result;
    },
    peek: (..._args: Array<unknown>) => state.peeked,
    reset: () => {
      state.queue = [];
      state.result = null;
      state.peeked = undefined;
      state.renders = 0;
    },
  };
  return state;
});
vi.mock(import("../../diagrams/mermaidRenderer"), async (original) => ({
  ...(await original()),
  renderMermaidDiagram: mermaid.render,
  peekMermaidDiagram: mermaid.peek,
}));
vi.mock("../../lib/observeResize", () => ({ observeResize: vi.fn(() => () => {}) }));

import { MarkdownMermaidCodeBlock } from "./MarkdownMermaidCodeBlock";
import { observeResize } from "../../lib/observeResize";

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];
  private target: Element | undefined;
  disconnect = vi.fn();

  constructor(private readonly report: (entries: Array<{ isIntersecting: boolean }>) => void) {
    TestIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.target = target;
  }

  visible() {
    this.report([{ isIntersecting: this.target?.closest("[hidden]") == null }]);
  }
}

const diagram = (text: string) => ({
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
  mermaid.reset();
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
    mermaid.result = diagram("diagram");
    await screen.rerender(block("graph TD\n A-->B", true));
    expect(displayedText()).toBe("graph TD\n A-->B");
    await screen.rerender(block("graph TD\n A-->B"));
    expect(mermaid.renders).toBe(0);
    await showVisible();
    expect(displayedText()).toBe("diagram");
    expect(mermaid.renders).toBe(1);
  });

  it("keeps a working diagram when a resize fails and replaces it after recovery", async () => {
    await using _test = await setupTest();
    mermaid.queue = [diagram("wide diagram"), null, diagram("narrow diagram")];
    await screen.rerender(block("flowchart LR\nA-->B"));
    await showVisible();
    expect(displayedText()).toBe("wide diagram");
    const [element, measure] = vi.mocked(observeResize).mock.calls.at(-1)!;
    const resized = element as HTMLElement;
    await act(async () => {
      resized.style.width = "320px";
      measure([]);
    });
    expect(displayedText()).toBe("wide diagram");
    await act(async () => {
      resized.style.width = "240px";
      measure([]);
    });
    expect(displayedText()).toBe("narrow diagram");
  });

  it("ignores a result for an outdated source", async () => {
    await using _test = await setupTest();
    const first = deferredResult();
    const second = deferredResult();
    mermaid.queue = [first.promise, second.promise];
    await screen.rerender(block("first"));
    await showVisible();
    await screen.rerender(block("second"));
    await showVisible();
    await act(async () => first.resolve(diagram("stale diagram")));
    expect(screen.container.querySelector("svg text")).toBeNull();
    await act(async () => second.resolve(diagram("second diagram")));
    expect(displayedText()).toBe("second diagram");
  });

  it("shows a changed source instead of the previous diagram while it lays out", async () => {
    await using _test = await setupTest();
    const changed = deferredResult();
    mermaid.queue = [diagram("first diagram"), changed.promise];
    await screen.rerender(block("graph TD\n A-->B"));
    await showVisible();
    expect(displayedText()).toBe("first diagram");
    await screen.rerender(block("graph TD\n A-->C"));
    expect(screen.container.querySelector("svg text")).toBeNull();
    expect(screen.container.querySelector("pre")!.textContent).toBe("graph TD\n A-->C");
    await showVisible();
    await act(async () => changed.resolve(diagram("second diagram")));
    expect(displayedText()).toBe("second diagram");
  });

  it("shows the source with an error when the diagram cannot be rendered", async () => {
    await using _test = await setupTest();
    mermaid.result = null;
    await screen.rerender(block("unsupported"));
    await showVisible();
    expect(screen.container.textContent).toContain("Unable to render diagram");
    expect(screen.container.querySelector("pre")!.textContent).toBe("unsupported");
  });

  it("renders a corrected source after a failed one", async () => {
    await using _test = await setupTest();
    mermaid.queue = [null, diagram("fixed diagram")];
    await screen.rerender(block("graph TD\n A--"));
    await showVisible();
    expect(screen.container.textContent).toContain("Unable to render diagram");
    await screen.rerender(block("graph TD\n A-->B"));
    await showVisible();
    expect(displayedText()).toBe("fixed diagram");
    expect(screen.container.textContent).not.toContain("Unable to render diagram");
  });

  it("copies the Mermaid source on remote HTTP pages without the Clipboard API", async () => {
    await using _test = await setupTest();
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as never);
    let copiedText: string | undefined;
    const execCommand = vi.spyOn(document, "execCommand").mockImplementation(() => {
      copiedText = (document.activeElement as HTMLTextAreaElement | null)?.value;
      return true;
    });
    mermaid.result = diagram("diagram");
    await screen.rerender(block("graph TD\n A"));
    await showVisible();
    await press("Copy code");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copiedText).toBe("graph TD\n A");
    expect(
      [...screen.container.querySelectorAll("button")].some(
        (button) => button.getAttribute("aria-label") === "Copied",
      ),
    ).toBe(true);
  });

  it("switches between the diagram and its code, redrawing a finished diagram at once", async () => {
    await using _test = await setupTest();
    mermaid.result = diagram("diagram");
    await screen.rerender(block("graph TD\n A"));
    await showVisible();
    await press("Show code");
    expect(displayedText()).toBe("graph TD\n A");
    mermaid.peeked = diagram("diagram");
    await press("Show diagram");
    expect(displayedText()).toBe("diagram");
    expect(mermaid.renders).toBe(1);
  });
});
