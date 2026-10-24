import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import "../index.css";

import { filesystemEnvironment } from "../state/filesystem";
import { useRightPanelStore } from "../rightPanelStore";
import { getSyntaxHighlighterPromise } from "../lib/syntaxHighlighting";
import { MarkdownFindContext } from "./chat/markdownFindContext";
import { useThreadFindHighlights } from "./chat/threadFindHighlights";
import { setMarkdownTaskChecked } from "./files/filePreviewMode";

const { workspaceSearch, filesystemMetadata } = vi.hoisted(() => ({
  workspaceSearch: vi.fn(),
  filesystemMetadata: vi.fn(),
}));
vi.mock(import("../state/use-atom-query-runner"), async (original) => ({
  ...(await original()),
  useAtomQueryRunner: ((family: unknown) =>
    family === filesystemEnvironment.getMetadata ? filesystemMetadata : workspaceSearch) as never,
}));

// Atoms derived from the server config run in the real registry over a missing config.
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});
// A standard client session, so environment-owned file links can open.
vi.mock(import("../state/session"), async (original) => {
  const { AuthStandardClientScopes } = await import("@supaterm/contracts");
  const granted = new Set<string>(AuthStandardClientScopes);
  const hasScope = (environmentId: unknown, scope: string) =>
    environmentId !== null && granted.has(scope);
  return {
    ...(await original()),
    useEnvironmentScope: hasScope as never,
    readEnvironmentScope: hasScope as never,
  };
});
vi.mock(import("../remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));
// Each test picks the rendered diagram text; the Mermaid worker is not what these tests exercise.
vi.mock(import("../diagrams/mermaidRenderer"), async (original) => ({
  ...(await original()),
  renderMermaidDiagram: vi.fn(),
  peekMermaidDiagram: vi.fn(),
}));
import { peekMermaidDiagram, renderMermaidDiagram } from "../diagrams/mermaidRenderer";
import { stubDiagramGeometry } from "../../test/diagramGeometry";

const settingsOverrides = vi.hoisted(() => ({ mathRenderingEnabled: false }));
vi.mock(import("../hooks/useSettings"), async (original) => {
  const actual = await original();
  type Settings = ReturnType<typeof actual.getClientSettings>;
  function useClientSettings<T = Settings>(select?: (settings: Settings) => T): T {
    const settings = { ...actual.getClientSettings(), ...settingsOverrides };
    return select ? select(settings) : (settings as T);
  }
  return { ...actual, useClientSettings };
});

import ChatMarkdown from "./ChatMarkdown";

const renderDiagram = vi.mocked(renderMermaidDiagram);
const diagramResult = (label: string) => ({
  svg: `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}"><text>${label}</text></svg>`,
  width: 100,
  height: 100,
  type: "flowchart" as const,
});

function setup() {
  settingsOverrides.mathRenderingEnabled = false;
  renderDiagram.mockReset().mockResolvedValue(diagramResult("Diagram"));
  vi.mocked(peekMermaidDiagram).mockReset();
  workspaceSearch.mockReset().mockResolvedValue(AsyncResult.success({ entries: [] }));
  filesystemMetadata.mockReset().mockResolvedValue(AsyncResult.success({ entries: [null] }));
}

function renderText(text: string, props: Partial<Parameters<typeof ChatMarkdown>[0]> = {}) {
  return render(<ChatMarkdown cwd="/tmp/project" text={text} {...props} />);
}

function buttonsLabelled(container: HTMLElement, label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.getAttribute("aria-label") === label,
  );
}

describe("ChatMarkdown favicon privacy", () => {
  it("suppresses private link images while preserving public links across updates", async () => {
    setup();
    const markdown = (url: string) => <ChatMarkdown cwd="/tmp/project" text={`[Link](${url})`} />;
    await using screen = await render(markdown("https://example.com"));
    const { container, rerender } = screen;
    expect([...container.querySelectorAll("img")].map((image) => image.src)).toEqual([
      "https://www.google.com/s2/favicons?domain=example.com&sz=32",
    ]);
    for (const url of ["http://192.168.1.10:8080", "http://localhost:3000", "http://home.arpa"]) {
      await rerender(markdown(url));
      expect(container.querySelectorAll("img")).toHaveLength(0);
    }
    await rerender(markdown("https://example.com"));
    expect(container.querySelectorAll("img")).toHaveLength(1);
    await rerender(markdown("https://github.com/supabitapp/supaterm/pull/1"));
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelector("a svg")).not.toBeNull();
  });
});

describe("ChatMarkdown streaming", () => {
  it("runs only a complete single-line shell block after a click", async () => {
    setup();
    const onRunShellCommand = vi.fn();
    const message = (text: string, isStreaming = false) => (
      <ChatMarkdown
        cwd="/tmp/project"
        text={text}
        isStreaming={isStreaming}
        onRunShellCommand={onRunShellCommand}
      />
    );
    await using screen = await render(message("```bash\necho hello\n```", true));
    const { container, rerender } = screen;
    const runButtons = () => buttonsLabelled(container, "Run in terminal");
    expect(runButtons()).toHaveLength(0);

    await rerender(message("```bash\necho hello\n```"));
    await act(async () => runButtons()[0]!.click());
    expect(onRunShellCommand).toHaveBeenCalledExactlyOnceWith("echo hello");

    for (const text of [
      "~~~bash\necho tilde\n~~~",
      "> ```bash\n> echo quote\n> ```",
      "````bash\necho four\n````",
      "- Command\n\n  ```bash\n  echo list\n  ```",
      "```bash\r\necho crlf\r\n```\r",
    ]) {
      await rerender(message(text));
      expect(runButtons()).toHaveLength(1);
    }

    for (const text of [
      "```bash\necho one\necho two\n```",
      "```typescript\necho hello\n```",
      "```bash\n\n```",
      "```bash\necho hello\n\n```",
      "```bash\necho hello\\\n```",
      "```bash\necho safe \u202e#\n```",
      "```bash\necho incomplete",
      "~~~bash\necho incomplete",
      "````bash\necho incomplete\n```",
      '<pre><code class="language-bash">echo html</code></pre>',
    ]) {
      await rerender(message(text));
      expect(runButtons()).toHaveLength(0);
    }
  });

  function spyOnStreamChunks(highlighter: Awaited<ReturnType<typeof getSyntaxHighlighterPromise>>) {
    const create = highlighter.createStreamTokenizer.bind(highlighter);
    const chunks = vi.fn<(chunk: string) => void>();
    const factory = vi.spyOn(highlighter, "createStreamTokenizer").mockImplementation((options) => {
      const stream = create(options);
      const enqueue = stream.enqueue.bind(stream);
      vi.spyOn(stream, "enqueue").mockImplementation((chunk) => {
        chunks(chunk);
        return enqueue(chunk);
      });
      return stream;
    });
    return Object.assign(factory, { chunks });
  }

  it("does not retokenize completed lines when streaming finishes", async () => {
    setup();
    const highlighter = await getSyntaxHighlighterPromise("typescript");
    using highlight = spyOnStreamChunks(highlighter);
    const text = "```typescript\nconst completed = 1;\nconst current = 2;";
    await using screen = await render(<ChatMarkdown cwd="/tmp/project" text={text} isStreaming />);
    const { rerender } = screen;
    await vi.waitFor(() => expect(highlight.chunks).toHaveBeenCalled());
    highlight.chunks.mockClear();
    await rerender(<ChatMarkdown cwd="/tmp/project" text={text + "\n```"} />);
    expect(highlight.chunks.mock.calls.every(([code]) => !code.includes("const completed"))).toBe(
      true,
    );
  });

  it("does not retokenize completed lines while the last line streams", async () => {
    const highlighter = await getSyntaxHighlighterPromise("typescript");
    using highlight = spyOnStreamChunks(highlighter);
    const message = (code: string) => (
      <ChatMarkdown
        cwd="/tmp/project"
        text={`\`\`\`typescript\nconst completed = 1;\n${code}`}
        isStreaming
      />
    );
    setup();
    await using screen = await render(message("const cur"));
    const { rerender } = screen;
    await vi.waitFor(() => expect(highlight.chunks).toHaveBeenCalled());
    highlight.chunks.mockClear();
    for (const code of ["const curr", "const current = 2;", "const current = 2;\nconst next"]) {
      await rerender(message(code));
    }
    expect(highlight.chunks).toHaveBeenCalled();
    expect(highlight.chunks.mock.calls.every(([code]) => !code.includes("const completed"))).toBe(
      true,
    );
  });

  it("recovers without duplicating code after a tokenizer fails during an append", async () => {
    setup();
    const highlighter = await getSyntaxHighlighterPromise("typescript");
    const create = highlighter.createStreamTokenizer.bind(highlighter);
    let fail = true;
    using _factory = vi
      .spyOn(highlighter, "createStreamTokenizer")
      .mockImplementation((options) => {
        const tokenizer = create(options);
        const enqueue = tokenizer.enqueue.bind(tokenizer);
        tokenizer.enqueue = (chunk) => {
          const result = enqueue(chunk);
          if (fail) {
            fail = false;
            throw new Error("Tokenization failed after consuming the chunk");
          }
          return result;
        };
        return tokenizer;
      });
    using _warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const message = (code: string) => (
      <ChatMarkdown cwd="/tmp/project" text={`\`\`\`typescript\n${code}`} isStreaming />
    );
    await using screen = await render(message("const first = 1;"));
    await vi.waitFor(() => expect(fail).toBe(false));
    const code = "const first = 1;\nconst second = 2;";
    await screen.rerender(message(code));
    await vi.waitFor(() => {
      expect(screen.container.querySelector(".chat-markdown-shiki code")?.textContent).toBe(
        `${code}\n`,
      );
    });
  });

  it("recovers highlighting after a failed fence changes without resetting its controls", async () => {
    setup();
    const highlighter = await getSyntaxHighlighterPromise("text");
    const createStreamTokenizer = highlighter.createStreamTokenizer.bind(highlighter);
    const codeToTokens = highlighter.codeToTokens.bind(highlighter);
    let fail = true;
    using _createStreamTokenizer = vi
      .spyOn(highlighter, "createStreamTokenizer")
      .mockImplementation((...args) => {
        if (fail) throw new Error("Temporary highlighter failure");
        return createStreamTokenizer(...args);
      });
    using _codeToTokens = vi.spyOn(highlighter, "codeToTokens").mockImplementation((...args) => {
      if (fail) throw new Error("Temporary highlighter failure");
      return codeToTokens(...args);
    });
    using _consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    using _consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await using screen = await render(
      <ChatMarkdown cwd="/tmp/project" text={"```text\ninitial\n```"} isStreaming />,
    );
    const { container, rerender } = screen;
    const codeBlock = container.querySelector<HTMLElement>('[data-language="text"]')!;
    const initialWrap = codeBlock.dataset.wrap === "true";
    await act(async () =>
      buttonsLabelled(container, initialWrap ? "Disable line wrap" : "Wrap lines")[0]!.click(),
    );
    expect(container.querySelectorAll(".chat-markdown-shiki")).toHaveLength(0);

    fail = false;
    await rerender(
      <ChatMarkdown cwd="/tmp/project" text={"```text\nrecovered\n```"} isStreaming />,
    );
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".chat-markdown-shiki")).toHaveLength(1),
    );
    expect(container.querySelector('[data-language="text"]')).toBe(codeBlock);
    expect(codeBlock.dataset.wrap).toBe(String(!initialWrap));
  });

  it("preserves code controls and details without highlighting an unchanged fence again", async () => {
    setup();
    const highlighter = await getSyntaxHighlighterPromise("text");
    using highlight = spyOnStreamChunks(highlighter);
    using writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockImplementation(async () => undefined);
    const text = [
      "```text",
      "First code block",
      "```",
      "",
      "<details><summary>More</summary>",
      "",
      "Details content",
      "",
      "</details>",
      "",
      "Streaming reply",
    ].join("\n");

    await using screen = await render(<ChatMarkdown cwd="/tmp/project" text={text} isStreaming />);
    const { container, rerender } = screen;
    const codeBlock = container.querySelector<HTMLElement>('[data-language="text"]')!;
    const initialWrap = codeBlock.dataset.wrap === "true";
    await act(async () => {
      buttonsLabelled(container, initialWrap ? "Disable line wrap" : "Wrap lines")[0]!.click();
      buttonsLabelled(container, "Copy code")[0]!.click();
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-markdown-details-summary]")!.click(),
    );
    const details = container.querySelector<HTMLElement>("[data-markdown-details]")!;
    expect(details.dataset.markdownDetailsOpen).toBe("true");
    expect(container.textContent).toContain("Details content");
    expect(writeText).toHaveBeenCalledWith("First code block\n");
    expect(highlight).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 10; index += 1) {
      await rerender(<ChatMarkdown cwd="/tmp/project" text={`${text} ${index}`} isStreaming />);
    }

    expect(highlight).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-language="text"]')).toBe(codeBlock);
    expect(codeBlock.dataset.wrap).toBe(String(!initialWrap));
    expect(container.querySelector("[data-markdown-details]")).toBe(details);
    expect(details.dataset.markdownDetailsOpen).toBe("true");
    await rerender(
      <ChatMarkdown
        cwd="/tmp/project"
        text={text.replace("First code block", "Updated code block")}
        isStreaming
      />,
    );
    const copy = [
      ...buttonsLabelled(container, "Copied"),
      ...buttonsLabelled(container, "Copy code"),
    ][0]!;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenLastCalledWith("Updated code block\n");
    expect(highlight).toHaveBeenCalledTimes(2);
  });

  it("edits the current task text and marker after reusing a renderer", async () => {
    setup();
    let editedText: string | undefined;
    let rerender: (next: ReactElement) => Promise<void> = async () => {};
    const message = (text: string): ReactElement => (
      <ChatMarkdown
        cwd="/tmp/project"
        text={text}
        onTaskListChange={({ markerOffset, checked }) => {
          editedText = setMarkdownTaskChecked(text, markerOffset, checked);
          void rerender(message(editedText));
        }}
      />
    );
    await using rendered = await render(message("- [ ] First\n- [ ] Second"));
    rerender = rendered.rerender;
    const { container } = rendered;
    const checkboxes = () => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const original = checkboxes()[1]!;
    await rerender(message("- [ ] A longer first task\n- [ ] Second"));
    expect(checkboxes()[1]).toBe(original);

    await act(async () => original.click());
    expect(editedText).toBe("- [ ] A longer first task\n- [x] Second");
    await vi.waitFor(() => expect(checkboxes()[1]!.checked).toBe(true));
  });

  it.each([
    { fadeInitialBlocks: true, fadesAtMount: true },
    { fadeInitialBlocks: false, fadesAtMount: false },
  ])(
    "arms the block fade at mount only when initial blocks fade: $fadeInitialBlocks",
    async ({ fadeInitialBlocks, fadesAtMount }) => {
      const message = (text: string) => (
        <ChatMarkdown
          cwd="/tmp/project"
          text={text}
          isStreaming
          fadeInitialBlocks={fadeInitialBlocks}
        />
      );
      await using screen = await render(message("First thought"));
      const { container, rerender } = screen;
      const streaming = () =>
        container.querySelector<HTMLElement>('div[class^="chat-markdown"]')!.dataset.streaming;
      expect(streaming()).toBe(fadesAtMount ? "" : undefined);

      await rerender(message("First thought\n\nSecond thought"));
      expect(streaming()).toBe("");
    },
  );
});

describe("ChatMarkdown diagrams", () => {
  it.each([
    { text: "```mermaid\ngraph TD\n A-->B\n```", streaming: false, expected: "diagram" },
    { text: "~~~MERMAID\ngraph TD\n A-->B\n~~~", streaming: false, expected: "diagram" },
    {
      text: "```mermaid\ngraph TD\n A-->B\n```\n\nFollowing text",
      streaming: true,
      expected: "diagram",
    },
    {
      text: "> ```mermaid\n> graph TD\n>  A-->B\n> ```",
      streaming: false,
      expected: "diagram",
    },
    {
      text: "```mermaid\ngraph TD\n A-->B",
      streaming: true,
      expected: "graph TD\n A-->B\n",
    },
  ])(
    "renders completed fences while retaining unfinished source: $text",
    async ({ text, streaming, expected }) => {
      using _geometry = stubDiagramGeometry();
      vi.mocked(renderMermaidDiagram).mockReset().mockResolvedValue({
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>',
        width: 100,
        height: 100,
        type: "flowchart",
      });
      await using screen = await renderText(text, { cwd: undefined, isStreaming: streaming });
      const { container } = screen;
      await vi.waitFor(() =>
        expect(
          (container.querySelector("code") ?? container.querySelector("svg text"))?.textContent,
        ).toBe(expected),
      );
      expect(renderMermaidDiagram).toHaveBeenCalledTimes(expected === "diagram" ? 1 : 0);
    },
  );
});

describe("ChatMarkdown workspace file opens", () => {
  const threadRef = {
    environmentId: EnvironmentId.make("workspace"),
    threadId: ThreadId.make("thread"),
  };

  it("keeps a newer absolute file open when an earlier repo-relative lookup finishes", async () => {
    setup();
    const result = AsyncResult.success({
      entries: [{ path: "notes/a.md", kind: "file" }],
      truncated: false,
    });
    let resolvePending!: (value: typeof result) => void;
    const pending = new Promise<typeof result>((resolve) => {
      resolvePending = resolve;
    });
    workspaceSearch.mockReturnValueOnce(pending);
    using openFile = vi
      .spyOn(useRightPanelStore.getState(), "openFile")
      .mockImplementation(() => {});
    await using screen = await renderText(
      "[Notes](physics/notes/a.md) and [Other](/elsewhere/b.md:9)",
      {
        cwd: "/school/physics",
        threadRef,
      },
    );
    const { container } = screen;
    const [notes, other] = container.querySelectorAll("a");
    await act(async () => notes!.click());
    expect(workspaceSearch).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();

    await act(async () => other!.click());
    await act(async () => resolvePending(result));

    expect(openFile).toHaveBeenCalledExactlyOnceWith(threadRef, "/elsewhere/b.md", 9);
    expect(workspaceSearch).toHaveBeenCalledOnce();
  });
});

describe("ChatMarkdown headings", () => {
  it("never gives two headings the same id, even when a suffix matches another heading", async () => {
    setup();
    await using screen = await renderText(
      '## Setup\n\n## Setup\n\n## Setup-1\n\n<h2 id="install-1">Pinned</h2>\n\n## Install\n\n## Install',
      { parseRawHtml: true },
    );
    const { container } = screen;
    expect([...container.querySelectorAll("h2")].map((heading) => heading.id)).toEqual([
      "user-content-setup",
      "user-content-setup-1",
      "user-content-setup-1-1",
      "user-content-install-1",
      "user-content-install",
      "user-content-install-2",
    ]);
  });
});

describe("ChatMarkdown Windows file links", () => {
  const environmentId = EnvironmentId.make("env-windows");
  const renderWindows = (text: string, parseRawHtml: boolean) =>
    renderText(text, {
      cwd: "C:/Users/shawn/project",
      environmentId,
      lineBreaks: !parseRawHtml,
      parseRawHtml,
    });
  const fileHrefs = (container: HTMLElement) =>
    [...container.querySelectorAll(".chat-markdown-file-link")].map((chip) =>
      chip.getAttribute("href"),
    );

  it("still rejects unsafe schemes", async () => {
    setup();
    for (const parseRawHtml of [true, false]) {
      await using screen = await renderWindows(
        "[unsafe](javascript:alert(1)) and [unknown](d:alert(1))",
        parseRawHtml,
      );
      const { container } = screen;
      expect(container.innerHTML).not.toContain("javascript:");
      expect(container.innerHTML).not.toContain("d:alert");
      expect(fileHrefs(container)).toEqual([]);
    }
  });
});

describe("ChatMarkdown thread find", () => {
  function FindProbe(props: {
    container: HTMLElement;
    query: string;
    activeOccurrence?: number;
    children: ReactElement;
  }) {
    useThreadFindHighlights({
      container: props.container,
      query: props.query,
      activeRowId: "row",
      activeOccurrence: props.activeOccurrence ?? 0,
      onActiveRange: () => {},
    });
    return (
      <div data-timeline-row-id="row">
        <div data-thread-find-text>
          <MarkdownFindContext value={props.query !== ""}>{props.children}</MarkdownFindContext>
        </div>
      </div>
    );
  }
  // Highlights live in a document-wide registry the rendered tree does not own.
  const clearHighlights = () => ({ [Symbol.dispose]: () => CSS.highlights.clear() });
  const activeHighlights = () =>
    [...(CSS.highlights.get("supaterm-thread-find-active") ?? [])].map((range) =>
      (range as Range).toString(),
    );

  it("keeps Mermaid diagrams rendered until find selects a match in their source", async () => {
    setup();
    using _highlights = clearHighlights();
    const container = document.createElement("div");
    const diagram = "```mermaid\ngraph TD; Alpha-->Beta\n```";
    const probe = (query: string) => (
      <FindProbe container={container} query={query}>
        <ChatMarkdown cwd={undefined} text={`Needle first.\n\n${diagram}\n\n${diagram}`} />
      </FindProbe>
    );
    vi.mocked(renderMermaidDiagram).mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Rendered diagram</text></svg>',
      width: 100,
      height: 100,
      type: "flowchart",
    });
    const diagrams = () => (container.textContent?.match(/Rendered diagram/g) ?? []).length;

    await using screen = await render(probe("Needle"), { container });
    // Diagrams render once the browser reports them in view.
    await vi.waitFor(() => expect(diagrams()).toBe(2));
    await screen.rerender(probe("Alpha"));
    await vi.waitFor(() => expect(diagrams()).toBe(1));
    await vi.waitFor(() => expect(activeHighlights()).toEqual(["Alpha"]));
  });
});
