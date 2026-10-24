import { act, render, fakeTimers } from "../../../test/render";
import { FileRenderer, getSharedHighlighter, type FileContents } from "@pierre/diffs";
import { useWorkerPool, type CodeViewProps } from "@pierre/diffs/react";
import { WorkerPoolManager, type WorkerRequest, type WorkerResponse } from "@pierre/diffs/worker";
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  workers: [] as Worker[],
  terminations: 0,
  requests: [] as WorkerRequest[],
  pools: new Map<WorkerPoolManager, Promise<void>>(),
  renderPools: [] as (WorkerPoolManager | undefined)[],
  failWorkers: false,
  holdInitialization: false,
  heldResponses: [] as (() => void)[],
  onInitializationHeld: undefined as (() => void) | undefined,
}));

vi.mock(import("../../hooks/useTheme"), async (original) => ({
  ...(await original()),
  useRenderedAppearance: (() => "dark") as never,
}));

// Wraps Pierre's real worker so the suite can count workers, read requests and hold startup.
// Vite's `?worker` export is a factory that returns a plain Worker, so this patches the instance.
vi.mock("@pierre/diffs/worker/worker.js?worker", async (original) => {
  const actual = await original<{ default: new () => Worker }>();
  return {
    ...actual,
    default: function TestDiffsWorker() {
      if (testState.failWorkers) throw new Error("Worker creation failed");
      const worker = new actual.default();
      testState.workers.push(worker);
      const addEventListener = worker.addEventListener.bind(worker);
      const postMessage = worker.postMessage.bind(worker);
      const terminate = worker.terminate.bind(worker);
      worker.addEventListener = (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type !== "message" || typeof listener !== "function") {
          addEventListener(type, listener);
          return;
        }
        addEventListener("message", (event) => {
          const data = (event as MessageEvent<WorkerResponse>).data;
          const deliver = () => listener(event);
          if (
            testState.holdInitialization &&
            data.type === "success" &&
            data.requestType === "initialize"
          ) {
            testState.heldResponses.push(deliver);
            if (testState.heldResponses.length === 2) testState.onInitializationHeld?.();
          } else {
            deliver();
          }
        });
      };
      worker.postMessage = (message: WorkerRequest) => {
        testState.requests.push(message);
        postMessage(message);
      };
      worker.terminate = () => {
        testState.terminations += 1;
        terminate();
      };
      return worker;
    },
  };
});

// Pierre's real viewer virtualizes into a shadow root; this stand-in renders each file through
// the same worker pool and keeps the highlighted HTML readable.
vi.mock(import("@pierre/diffs/react"), async (original) => ({
  ...(await original()),
  CodeView: ((props: CodeViewProps<undefined, undefined>) =>
    props.items?.map((item) =>
      item.type === "file" ? <FileOutput key={item.id} file={item.file} /> : null,
    )) as never,
}));

import { StyledDiffCodeView } from "./StyledDiffCodeView";

function FileOutput({ file }: { file: FileContents }) {
  const pool = useWorkerPool();
  const [html, setHtml] = useState("");
  useEffect(() => {
    testState.renderPools.push(pool);
    const renderer = new FileRenderer(
      { theme: "pierre-dark", preferredHighlighter: "highlights" },
      undefined,
      render,
      pool,
    );
    function render() {
      const result = renderer.renderFile(file);
      if (result) setHtml(renderer.renderFullHTML(result));
    }
    render();
    return () => renderer.cleanUp();
  }, [file, pool]);
  return <pre data-code-file={file.name}>{html}</pre>;
}

const files = [
  { name: "notes.txt", contents: "Plain text is ready.\n", cacheKey: "plain-text" },
  { name: "answer.ts", contents: "const answer = 42;\n", cacheKey: "typescript" },
] satisfies FileContents[];

function Views({ count }: { count: number }) {
  const [draft, setDraft] = useState("Draft");
  return (
    <>
      <button onClick={() => setDraft("Edited draft")}>{draft}</button>
      {files.slice(0, count).map((file) => (
        <StyledDiffCodeView key={file.name} items={[{ type: "file", id: file.name, file }]} />
      ))}
    </>
  );
}

function renderViews(count: number) {
  return (
    <StrictMode>
      <Views count={count} />
    </StrictMode>
  );
}

// Pierre rejects a pool whose workers take 10s to start. Real workers share the runner with the
// rest of the suite, so outside the test of that limit the test's own timeout is the only deadline.
const UNLIMITED_WORKER_STARTUP_MS = 120_000;

// Queries stay inside the test's own container: a timed-out test keeps running and leaves its
// views mounted while the next test starts.
const codeFile = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-code-file="${name}"]`)?.textContent ?? "";

describe("code-view worker lifecycle", () => {
  function setup() {
    testState.workers = [];
    testState.terminations = 0;
    testState.requests = [];
    testState.pools.clear();
    testState.renderPools = [];
    testState.failWorkers = false;
    testState.holdInitialization = false;
    testState.heldResponses = [];
    testState.onInitializationHeld = undefined;
  }
  // Worker startup runs on real time, so only the idle expiry checks use this clock.
  // Faking startup too would let advancing the idle clock time out a worker startup.
  // oxlint-disable-next-line supaterm/no-frame-waits-in-browser-tests -- the worker pool must start on real time.
  const idleClock = () => fakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  async function workerEnvironment({ startupLimit = UNLIMITED_WORKER_STARTUP_MS } = {}) {
    await using stack = new AsyncDisposableStack();
    // Pins the pool at two workers whatever machine runs the suite.
    stack.use(vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(2));
    const initialize = WorkerPoolManager.prototype.initialize;
    stack.use(
      vi.spyOn(WorkerPoolManager.prototype, "initialize").mockImplementation(function (
        this: WorkerPoolManager,
        ...args
      ) {
        // The provider builds the pool without this option, so it is set before startup reads it.
        const options: { workerInitializationTimeout?: number } = Reflect.get(this, "options");
        options.workerInitializationTimeout = startupLimit;
        const pending = initialize.apply(this, args);
        testState.pools.set(this, pending);
        return pending;
      }),
    );
    // Runs out the idle timer each view's unmount scheduled, releasing its pool.
    stack.defer(async () => {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    });
    const environment = stack.move();
    return {
      async render(ui: ReactNode) {
        const view = environment.use(await render(ui, { router: false }));
        // Disposed before the view, so its unmount schedules the idle timer on a fake clock
        // that the run-out above then restores.
        environment.defer(() => {
          if (!vi.isFakeTimers()) idleClock();
        });
        return view;
      },
      [Symbol.asyncDispose]: () => environment.disposeAsync(),
    };
  }

  it("renders through Pierre's main-thread fallback when worker creation fails", async () => {
    setup();
    await using workers = await workerEnvironment();
    testState.failWorkers = true;
    const { container } = await workers.render(renderViews(1));
    const pool = [...testState.pools.keys()][0]!;
    await act(async () => {
      await expect(testState.pools.get(pool)).rejects.toMatchObject({ _tag: "DiffWorkerError" });
      await getSharedHighlighter({
        themes: ["pierre-dark"],
        langs: ["text"],
        preferredHighlighter: "highlights",
      });
    });
    expect(pool.isWorkingPool()).toBe(false);
    expect(testState.workers).toHaveLength(0);
    await vi.waitFor(() =>
      expect(codeFile(container, "notes.txt")).toContain("Plain text is ready."),
    );
  });
});
