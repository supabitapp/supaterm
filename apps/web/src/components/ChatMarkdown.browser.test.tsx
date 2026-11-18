import { MISSING_FILE_ACCESS_MESSAGE } from "@supaterm/client-runtime/state/assets";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import "../index.css";

import { filesystemEnvironment } from "../state/filesystem";
import { useRightPanelStore } from "../rightPanelStore";
import { remarkEnableOrderedListNumbers } from "@supaterm/shared/markdownPipeline";
import { setMarkdownTaskChecked } from "@supaterm/shared/markdownTaskList";
import { getSyntaxHighlighterPromise } from "../lib/syntaxHighlighting";
import { MarkdownFindContext } from "./chat/markdownFindContext";
import { useThreadFindHighlights } from "./chat/threadFindHighlights";

const { workspaceSearch, filesystemMetadata } = vi.hoisted(() => ({
  workspaceSearch: vi.fn(),
  filesystemMetadata: vi.fn(),
}));
const parsedSources = vi.hoisted(() => [] as string[]);
vi.mock(import("mdast-util-from-markdown"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    fromMarkdown: ((source: string, ...rest: never[]) => {
      parsedSources.push(String(source));
      return (actual.fromMarkdown as (...args: unknown[]) => unknown)(source, ...rest);
    }) as typeof actual.fromMarkdown,
  };
});

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
const deniedEnvironmentId = vi.hoisted(() => "denied-environment");
vi.mock(import("../state/filesystem"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useFilesystemReadAccess: ((environmentId: EnvironmentId | null) =>
      environmentId === deniedEnvironmentId
        ? { canReadFiles: false, isPending: false, error: null }
        : actual.useFilesystemReadAccess(environmentId)) as never,
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

const appearance = vi.hoisted(() => ({
  value: "light" as "light" | "dark",
  listeners: new Set<() => void>(),
}));
vi.mock(import("../hooks/useTheme"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    appearance.listeners.add(listener);
    return () => appearance.listeners.delete(listener);
  };
  return {
    ...(await original()),
    useRenderedAppearance: () => useSyncExternalStore(subscribe, () => appearance.value),
  };
});

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
import { chatMarkdownClipboardPayload } from "../markdown-clipboard";
import { AudioPreview } from "./files/AudioPreview";

it("keeps compact audio playback loaded across signed URL renewals", async () => {
  const original =
    "data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA";
  const renewed = `${original}#renewed`;
  const preview = (src: string, revision = "clip-v1") => (
    <AudioPreview compact name="clip.wav" src={src} revision={revision} />
  );
  await using screen = await render(preview(original));
  const audio = screen.container.querySelector("audio")!;
  await act(() => {
    audio.dispatchEvent(new Event("loadedmetadata"));
    audio.dispatchEvent(new Event("play"));
  });
  await screen.rerender(preview(renewed));
  expect(screen.container.querySelector("audio")).toBe(audio);
  expect(audio.getAttribute("src")).toBe(original);
  await expect.element(screen.getByRole("button", { name: "Pause clip.wav" })).toBeEnabled();
  await screen.rerender(preview(renewed, "clip-v2"));
  expect(screen.container.querySelector("audio")).not.toBe(audio);
  expect(screen.container.querySelector("audio")?.getAttribute("src")).toBe(renewed);
});

const renderDiagram = vi.mocked(renderMermaidDiagram);
const diagramResult = (label: string) => ({
  svg: `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}"><text>${label}</text></svg>`,
  width: 100,
  height: 100,
  type: "flowchart" as const,
});

function setup() {
  appearance.value = "light";
  parsedSources.length = 0;
  settingsOverrides.mathRenderingEnabled = false;
  renderDiagram.mockReset().mockResolvedValue(diagramResult("Diagram"));
  vi.mocked(peekMermaidDiagram).mockReset();
  workspaceSearch.mockReset().mockResolvedValue(AsyncResult.success({ entries: [] }));
  filesystemMetadata.mockReset().mockResolvedValue(AsyncResult.success({ entries: [null] }));
}

function renderText(text: string, props: Partial<Parameters<typeof ChatMarkdown>[0]> = {}) {
  return render(<ChatMarkdown cwd="/tmp/project" text={text} {...props} />);
}

function buttonsLabelled(container: HTMLElement, label: string | RegExp) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => {
    const ariaLabel = button.getAttribute("aria-label") ?? "";
    return typeof label === "string" ? ariaLabel === label : label.test(ariaLabel);
  });
}

const SOURCE_NUMBER_PLUGINS = [remarkEnableOrderedListNumbers];

it("keeps decimal markers in nested user lists while documents keep their counter styles", async () => {
  setup();
  const text = "1. Outer\n   1. Nested\n   7. Skipped\n      1. Deeper\n      4. Fourth";
  await using screen = await render(
    <div className="grid grid-cols-2 gap-8 p-8">
      <section>
        <h2>User message</h2>
        <ChatMarkdown
          cwd={undefined}
          text={text}
          className="user-message-markdown"
          extraRemarkPlugins={SOURCE_NUMBER_PLUGINS}
        />
      </section>
      <section>
        <h2>Markdown preview</h2>
        <ChatMarkdown cwd={undefined} text={text} />
      </section>
    </div>,
  );
  await expect.element(screen.getByText("User message", { exact: true })).toBeVisible();
  const [message, preview] = screen.container.querySelectorAll(".chat-markdown");
  expect(
    [...message!.querySelectorAll("ol")].map((list) => getComputedStyle(list).listStyleType),
  ).toEqual(["decimal", "decimal", "decimal"]);
  expect(
    [...preview!.querySelectorAll("ol")].map((list) => getComputedStyle(list).listStyleType),
  ).toEqual(["decimal", "lower-alpha", "lower-roman"]);
});

it("shows unavailable audio when a workspace embed has no thread", async () => {
  setup();
  await using screen = await renderText("![recording](clip.wav)");
  expect(screen.container.textContent).toContain("Audio unavailable");
  expect(screen.container.textContent).not.toContain("Loading audio");
  expect(screen.container.querySelector("audio")).toBeNull();
});

it("resolves the <picture> source for the current theme like any other image", async () => {
  setup();
  await using screen = await renderText(
    '<picture><source media="(prefers-color-scheme: dark)" srcset="/tmp/project/dark.png"><img src="/tmp/project/light.png" alt="Shot"></picture>',
  );
  const resolved = () =>
    screen.container.querySelector("[data-markdown-copy]")?.getAttribute("data-markdown-copy");
  await vi.waitFor(() => expect(resolved()).toBe("![Shot](/tmp/project/light.png)"));

  await act(() => {
    appearance.value = "dark";
    for (const listener of appearance.listeners) listener();
  });
  await vi.waitFor(() => expect(resolved()).toBe("![Shot](/tmp/project/dark.png)"));
});

it("sizes a raw HTML image by width and height written with px units", async () => {
  setup();
  const largeImage = `${window.location.origin}/icon-192x192.png`;
  await using screen = await render(
    <ChatMarkdown
      cwd={undefined}
      parseRawHtml
      text={`### PR Review in progress <img src="${largeImage}" alt="spinner" width="14px" height="7px" />`}
    />,
  );
  const image = screen.getByAltText("spinner");
  await expect.element(image).toHaveAttribute("src", largeImage);
  const element = image.element() as HTMLImageElement;
  await element.decode();
  const { width, height } = element.getBoundingClientRect();
  expect({ width, height }).toEqual({ width: 14, height: 7 });
});

it("reuses the parse of a streaming reply's finished blocks when it remounts", async () => {
  setup();
  const message = (
    <ChatMarkdown cwd="/tmp/project" text={"Finished block\n\nStill growing"} isStreaming />
  );
  {
    await using first = await render(
      <ChatMarkdown cwd="/tmp/project" text={"Finished block\n\n"} isStreaming />,
    );
    await first.rerender(message);
  }
  await using screen = await render(message);
  await expect.element(screen.getByText("Still growing")).toBeVisible();
  expect(parsedSources.filter((source) => source.includes("Finished block"))).toHaveLength(1);
});

it("reuses the parse of a remounted message that has stable extra plugins", async () => {
  setup();
  const parsed = vi.fn();
  const countingPlugins = [() => () => void parsed()];
  const message = (
    <ChatMarkdown cwd="/tmp/project" text="Cached text" extraRemarkPlugins={countingPlugins} />
  );
  {
    await using first = await render(
      <ChatMarkdown
        cwd="/tmp/project"
        text="Cached text"
        extraRemarkPlugins={countingPlugins}
        isStreaming
      />,
    );
    await first.rerender(message);
  }
  await using screen = await render(message);
  await expect.element(screen.getByText("Cached text")).toBeVisible();
  expect(parsed).toHaveBeenCalledTimes(1);
  const changed = vi.fn();
  await screen.rerender(
    <ChatMarkdown
      cwd="/tmp/project"
      text="Cached text"
      extraRemarkPlugins={[() => () => void changed()]}
    />,
  );
  expect(changed).toHaveBeenCalledTimes(1);
});

it("highlights a code block's own source when an earlier block of the same length was cached", async () => {
  setup();
  const highlightedText = (container: HTMLElement) =>
    container.querySelector(".chat-markdown-shiki")?.textContent?.trim();
  // These two lines share a 32-bit FNV-1a hash and a length.
  const first = 'const commitSha = "f36a6d8fe0aa";';
  const second = 'const commitSha = "cb06f8d135b3";';
  // The block suspends until the shared highlighter loads, which can outlast vi.waitFor on a busy runner.
  await getSyntaxHighlighterPromise("ts");
  {
    await using screen = await renderText(`\`\`\`ts\n${first}\n\`\`\``);
    await vi.waitFor(() => expect(highlightedText(screen.container)).toBe(first));
  }
  await using screen = await renderText(`\`\`\`ts\n${second}\n\`\`\``);
  await vi.waitFor(() => expect(highlightedText(screen.container)).toBe(second));
});

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

describe("ChatMarkdown external link labels", () => {
  it("keeps a leading emoji whole", async () => {
    setup();
    await using screen = await render(
      <ChatMarkdown cwd="/tmp/project" text="[😀 Read the documentation](https://example.com)" />,
    );
    await vi.waitFor(() => {
      const link = screen.container.querySelector("a");
      expect(link?.textContent).toContain("😀 Read");
      const walker = document.createTreeWalker(link!, NodeFilter.SHOW_TEXT);
      const textNodes: string[] = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode.nodeValue ?? "");
      expect(textNodes.filter((node) => /\p{Surrogate}/u.test(node))).toEqual([]);
    });
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
      "```bash\necho trailing blank\n\n```",
    ]) {
      await rerender(message(text));
      expect(runButtons()).toHaveLength(1);
    }

    for (const text of [
      "```typescript\necho hello\n```",
      "```bash\n\n```",
      "```bash\necho hello\\\n```",
      "```bash\necho safe \u202e#\n```",
      "```bash\necho incomplete",
      "~~~bash\necho incomplete",
      "````bash\necho incomplete\n```",
      '<pre><code class="language-bash">echo html</code></pre>',
    ]) {
      await rerender(message(text));
      expect(buttonsLabelled(container, /^Run /)).toHaveLength(0);
    }
  });

  describe("multi-line shell scripts", () => {
    const onRunShellCommand = vi.fn();
    const script = (code: string) => (
      <ChatMarkdown
        cwd="/tmp/project"
        text={`\`\`\`bash\n${code}\n\`\`\``}
        onRunShellCommand={onRunShellCommand}
      />
    );
    const dialog = () => document.querySelector('[role="alertdialog"]');
    const dialogButton = (label: string) =>
      [...(dialog()?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === label,
      );

    async function openDialog(code: string) {
      setup();
      onRunShellCommand.mockReset();
      const screen = await render(script(code));
      const [runButton] = buttonsLabelled(screen.container, /^Run \d+ lines in terminal$/);
      await act(async () => runButton!.click());
      return screen;
    }

    it("runs the script only after the dialog confirms it", async () => {
      const code = "vp i\ncat > .env <<'EOF'\nA=1\nEOF";
      await using _screen = await openDialog(code);
      await vi.waitFor(() => expect(dialog()?.textContent).toContain("Run 4 lines in terminal?"));
      expect(onRunShellCommand).not.toHaveBeenCalled();

      await act(async () => dialogButton("Run")!.click());
      expect(onRunShellCommand).toHaveBeenCalledExactlyOnceWith(code);
    });

    it("does not run the script when the dialog is cancelled", async () => {
      await using _screen = await openDialog("echo one\necho two");
      await vi.waitFor(() => expect(dialogButton("Cancel")).toBeDefined());
      await act(async () => dialogButton("Cancel")!.click());
      await vi.waitFor(() => expect(dialog()).toBeNull());
      expect(onRunShellCommand).not.toHaveBeenCalled();
    });

    it("drops the confirmation when the script changes while it is open", async () => {
      await using screen = await openDialog("echo one\necho two");
      await vi.waitFor(() => expect(dialog()).not.toBeNull());
      await screen.rerender(script("echo one\necho three"));
      await vi.waitFor(() => expect(dialog()).toBeNull());
      await screen.rerender(script("echo one\necho two"));
      expect(dialog()).toBeNull();
      expect(onRunShellCommand).not.toHaveBeenCalled();
    });

    it.each([
      "echo one\necho two\\",
      "$ echo one\noutput",
      "echo one\necho \u202etwo",
      "echo\tone",
    ])("does not offer to run %j", async (code) => {
      setup();
      await using screen = await render(script(code));
      expect(buttonsLabelled(screen.container, /^Run /)).toHaveLength(0);
    });
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
    expect(writeText).toHaveBeenCalledWith("First code block");
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
    expect(writeText).toHaveBeenLastCalledWith("Updated code block");
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
    await rerender(message("- [ ] A longer first task\n- [ ] Second"));
    expect(checkboxes()[1]).toBe(original);
    expect(checkboxes()[1]!.checked).toBe(false);
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

  it.each([
    ["read-only", undefined],
    ["editable", () => {}],
  ])(
    "unchecks the remaining %s task when the checked row above it is removed",
    async (_, onTaskListChange) => {
      setup();
      const message = (text: string) => (
        <ChatMarkdown cwd="/tmp/project" text={text} onTaskListChange={onTaskListChange} />
      );
      await using screen = await render(message("- [x] Completed item\n- [ ] Pending item"));
      await screen.rerender(message("- [ ] Pending item"));
      const checkboxes =
        screen.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(checkboxes).toHaveLength(1);
      expect(checkboxes[0]!.checked).toBe(false);
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

describe("ChatMarkdown skill chips", () => {
  it("shows the skill's details and opens its instructions, closing the details", async () => {
    setup();
    const threadRef = {
      environmentId: EnvironmentId.make("workspace"),
      threadId: ThreadId.make("thread"),
    };
    await using screen = await renderText("Run $review now", {
      threadRef,
      skills: [
        {
          name: "review",
          displayName: "Review",
          description: "Reviews the current branch.",
          path: "/skills/review/SKILL.md",
          enabled: true,
        },
      ],
    });
    using openFile = vi
      .spyOn(useRightPanelStore.getState(), "openFile")
      .mockImplementation(() => {});

    await userEvent.click(screen.getByRole("button", { name: "Skill Review. Show details" }));
    await expect.element(page.getByText("Reviews the current branch.")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "View instructions" }));

    expect(openFile).toHaveBeenCalledExactlyOnceWith(threadRef, "/skills/review/SKILL.md");
    await expect.element(page.getByText("Reviews the current branch.")).not.toBeInTheDocument();
  });
});

describe("ChatMarkdown headings", () => {
  it("keeps insight streaming, reference links, and heading anchors in one message", async () => {
    setup();
    const rule = "─".repeat(20);
    const text = `## Setup\n\nBefore [source][src].\n\n★ Insight ${rule}\nA **streaming** note.`;
    const message = (text: string, isStreaming: boolean) => (
      <ChatMarkdown
        cwd={undefined}
        text={text}
        renderInsights
        lineBreaks
        isStreaming={isStreaming}
      />
    );
    await using screen = await render(message(text, true));
    await expect.element(screen.getByRole("note")).toHaveTextContent("Insight A streaming note.");
    await screen.rerender(
      message(
        `${text}\n${rule}\n\n## Setup\n\nAfter [source][src].\n\n[src]:\n  https://example.com`,
        false,
      ),
    );
    await expect.element(screen.getByRole("note")).toHaveTextContent("Insight A streaming note.");
    expect([...screen.container.querySelectorAll("h2")].map((heading) => heading.id)).toEqual([
      "user-content-setup",
      "user-content-setup-1",
    ]);
    expect(
      [...screen.container.querySelectorAll("a")].filter(
        (link) => link.href === "https://example.com/",
      ),
    ).toHaveLength(2);
    await expect.element(screen.getByRole("note")).not.toHaveTextContent("After");
  });

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

describe("ChatMarkdown inline code selection", () => {
  it("selects only a word on double-click in inline and fenced code", async () => {
    setup();
    await using screen = await renderText(
      "Run `migration-gate --dry-run` first.\n\n```txt\nfenced-block word\n```",
    );
    await userEvent.dblClick(screen.getByText("migration-gate --dry-run"), {
      position: { x: 12, y: 8 },
    });
    expect(window.getSelection()?.toString()).toBe("migration");

    window.getSelection()?.removeAllRanges();
    const fenced = screen.container.querySelector("pre code")!;
    await userEvent.dblClick(fenced, { position: { x: 4, y: 4 } });
    expect(window.getSelection()?.toString()).toBe("fenced");
  });

  it("selects the whole line on triple-click beside a favicon link or a file chip", async () => {
    setup();
    await using screen = await renderText(
      "Before [docs](https://example.com/docs) after words\n\nBefore [App.tsx](/tmp/project/src/App.tsx) after words",
    );
    const tripleClickWord = async (paragraph: HTMLElement, word: string) => {
      const text = [...paragraph.childNodes].find((node) => node.textContent?.includes(word))!;
      const range = document.createRange();
      range.setStart(text, text.textContent!.indexOf(word));
      range.setEnd(text, text.textContent!.indexOf(word) + word.length);
      const wordBox = range.getBoundingClientRect();
      const paragraphBox = paragraph.getBoundingClientRect();
      window.getSelection()?.removeAllRanges();
      await userEvent.tripleClick(paragraph, {
        position: {
          x: wordBox.left - paragraphBox.left + wordBox.width / 2,
          y: wordBox.top - paragraphBox.top + wordBox.height / 2,
        },
      });
      return window.getSelection()?.toString().trim();
    };

    const paragraphs = screen.container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    const selections = [];
    const lines = [];
    for (const paragraph of paragraphs) {
      lines.push(paragraph.textContent?.trim(), paragraph.textContent?.trim());
      selections.push(
        await tripleClickWord(paragraph, "Before"),
        await tripleClickWord(paragraph, "after"),
      );
    }
    expect(selections).toEqual(lines);
  });
});

describe("ChatMarkdown copy", () => {
  it("copies a fully selected callout as alert Markdown and a partial one as text", async () => {
    setup();
    await using screen = await renderText("> [!WARNING]\n> Back up first.");
    const [label, body] = screen.container.querySelectorAll('[role="note"] > p');
    const select = (startNode: Node, endNode: Node, endOffset: number) => {
      const range = document.createRange();
      range.setStart(startNode, 0);
      range.setEnd(endNode, endOffset);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return chatMarkdownClipboardPayload(selection)?.text;
    };
    const labelText = label!.lastChild!;
    const bodyText = body!.firstChild!;

    expect(select(labelText, bodyText, bodyText.textContent!.length)).toBe(
      "> [!WARNING]\n> Back up first.",
    );
    expect(select(labelText, bodyText, "Back up".length)).toBe("Warning\n\nBack up");
  });

  it("copies part of inline code without prose escapes", async () => {
    setup();
    await using screen = await renderText("Read `items[0]*_x` and a*b*c.");
    const code = screen.container.querySelector("p code")!.firstChild!;
    const range = document.createRange();
    range.setStart(code, 0);
    range.setEnd(code, "items[0]*_".length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(chatMarkdownClipboardPayload(selection)?.text).toBe("items[0]*_");
  });

  it.each([
    {
      source: "10. First\n11. Second\n12. Third\n\nAfter.",
      from: "Second",
      text: "11. Second\n12. Third\n\nAfter.",
    },
    {
      source: "1. A\n2. B\n7. C\n8. D\n\nAfter.",
      from: "D",
      userMessage: true,
      text: "8. D\n\nAfter.",
    },
    {
      source: "1. Outer\n2. Next\n   1. Inner\n   2. Deeper\n\nAfter.",
      from: "Deeper",
      text: "2. 2. Deeper\n\nAfter.",
    },
  ])(
    "keeps the shown numbers when a copy starts at $from and ends past the list",
    async ({ source, from, userMessage, text }) => {
      setup();
      await using screen = await renderText(
        source,
        userMessage ? { extraRemarkPlugins: SOURCE_NUMBER_PLUGINS } : {},
      );
      const start = [...screen.container.querySelectorAll("li")]
        .flatMap((item) => [...item.childNodes])
        .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent === from)!;
      const after = [...screen.container.querySelectorAll("p")].at(-1)!.firstChild!;
      const range = document.createRange();
      range.setStart(start, 0);
      range.setEnd(after, after.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const payload = chatMarkdownClipboardPayload(selection);
      expect(payload?.text).toBe(text);
      // Rich paste numbers its list from the same start.
      expect(
        new DOMParser()
          .parseFromString(payload!.html, "text/html")
          .querySelector("li")
          ?.closest("ol")?.start,
      ).toBe(Number(text.split(".")[0]));
    },
  );
});

describe("ChatMarkdown editor deep links", () => {
  const hrefs = (container: HTMLElement) =>
    [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));

  it("keeps local editor file links", async () => {
    setup();
    await using screen = await renderText(
      "[file.md line 3](cursor://file/Users/me/repo/file.md:3) and [same](vscode://file/Users/me/repo/file.md:3:7)",
    );
    expect(hrefs(screen.container)).toEqual([
      "cursor://file/Users/me/repo/file.md:3",
      "vscode://file/Users/me/repo/file.md:3:7",
    ]);
  });

  it("still drops other editor links and unknown schemes", async () => {
    setup();
    await using screen = await renderText(
      "[prompt](cursor://anysphere.cursor-deeplink/prompt?text=hi) [user](cursor://me@file/Users/me/file.md) [unknown](foo://file/Users/me/file.md)",
    );
    expect(screen.container.innerHTML).not.toContain("://");
    expect(hrefs(screen.container).filter(Boolean)).toEqual([]);
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

describe("ChatMarkdown host media", () => {
  it("explains a host video the connection cannot read instead of offering a retry", async () => {
    setup();
    await using screen = await renderText("![Demo](/tmp/demo.mp4)", {
      threadRef: {
        environmentId: EnvironmentId.make(deniedEnvironmentId),
        threadId: ThreadId.make("thread"),
      },
    });
    await vi.waitFor(() =>
      expect(screen.container.textContent).toContain(MISSING_FILE_ACCESS_MESSAGE),
    );
    expect(screen.container.textContent).not.toContain("Retry video");
  });
});
