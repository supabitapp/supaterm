import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentThreadState } from "@supaterm/client-runtime/state/threads";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  OrchestrationV2DispatchCommandError,
  ThreadId,
} from "@supaterm/contracts";
import { serializeAssistantCitation } from "@supaterm/shared/assistantCitations";
import {
  formatComposerContextReference,
  toComposerContextId,
} from "@supaterm/shared/composerContextReferences";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, type Atom, AtomRegistry } from "effect/reactivity";
import { createRef, Profiler, useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  threadState: null as unknown as Atom.Writable<AsyncResult.AsyncResult<EnvironmentThreadState>>,
  workflow: null as unknown,
  commands: [] as Array<{ command: unknown; input: unknown }>,
  commandResult: undefined as unknown,
}));

vi.mock(import("@supaterm/client-runtime/state/thread-workflows"), async (importOriginal) => ({
  ...(await importOriginal()),
  deriveThreadQueueWorkflowState: (() => state.workflow) as never,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useQuietThreadShell: ((target: unknown) =>
    target === null ? null : { title: "Release lead" }) as never,
}));

vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({
    data: { tasks: [{ id: "task:webhook", title: "PR dispatcher" }] },
  })) as never,
}));

// The thread detail atoms are real, fed by one state atom the test writes.
vi.mock(import("../../state/threads"), async (importOriginal) => {
  const { createEnvironmentThreadDetailAtoms, EMPTY_ENVIRONMENT_THREAD_STATE } =
    await import("@supaterm/client-runtime/state/threads");
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const Option = await import("effect/Option");
  const { makeThreadProjectionFixture } = await import("../../test-fixtures");
  state.threadState = Atom.make<AsyncResult.AsyncResult<EnvironmentThreadState>>(
    AsyncResult.success({
      ...EMPTY_ENVIRONMENT_THREAD_STATE,
      data: Option.some(makeThreadProjectionFixture()),
    }),
  ).pipe(Atom.keepAlive);
  return {
    ...(await importOriginal()),
    environmentThreadDetails: createEnvironmentThreadDetailAtoms(() => state.threadState),
  };
});

vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: ((command: unknown) => async (input: unknown) => {
    state.commands.push({ command, input });
    return state.commandResult;
  }) as never,
}));

vi.mock(import("../../assets/assetUrls"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAssetUrls: ((_environmentId: never, resources: ReadonlyArray<{ attachmentId: string }>) =>
    resources.map((resource) => `https://assets.test/${resource.attachmentId}`)) as never,
}));

import "~/index.css";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@supaterm/client-runtime/state/threads";

import { act, render as renderUi } from "../../../test/render";
import { threadEnvironment } from "../../state/threads";
import { makeStreamingTimelineFixture, makeThreadProjectionFixture } from "../../test-fixtures";
import { ToastProvider } from "../ui/toast";
import { ExpandedImageDialog } from "./ExpandedImageDialog";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { QueuedRunsControl, type QueuedRunsControlHandle } from "./QueuedRunsControl";

function setup() {
  state.workflow = null;
  state.commands = [];
  state.commandResult = undefined;
}

const baseProps = {
  environmentId: "environment:test" as never,
  threadId: "thread:test" as never,
  deferredSteering: false,
  editingRunId: null,
  editBlockedReason: null,
  onEditQueuedRun: () => undefined,
  onCancelEdit: () => undefined,
  onOpenThread: () => undefined,
  onImageExpand: () => undefined,
} satisfies ComponentProps<typeof QueuedRunsControl>;

async function renderQueue(props: Partial<ComponentProps<typeof QueuedRunsControl>> = {}) {
  return renderUi(<QueuedRunsControl {...baseProps} {...props} />);
}

it("opens queued images in the existing gallery", async () => {
  setup();
  const attachments = ["first.png", "second.png"].map((name) => ({
    type: "image" as const,
    id: name,
    name,
    mimeType: "image/png",
    sizeBytes: 128,
  }));
  state.workflow = {
    activeRun: null,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Later",
        attachments,
      },
    ],
  };
  function QueueWithGallery() {
    const [preview, setPreview] = useState<ExpandedImagePreview | null>(null);
    return (
      <>
        <QueuedRunsControl {...baseProps} onImageExpand={setPreview} />
        {preview ? (
          <ExpandedImageDialog preview={preview} onClose={() => setPreview(null)} />
        ) : null}
      </>
    );
  }
  await using _screen = await renderUi(<QueueWithGallery />);

  await page.getByRole("button", { name: "Preview second.png", exact: true }).click();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await expect.element(page.getByText("second.png (2/2)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous media", exact: true }).click();
  await expect.element(page.getByText("first.png (1/2)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back, close image preview", exact: true }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(page.getByText("Later", { exact: true })).toBeVisible();
});

const labels = (container: HTMLElement) =>
  [...container.querySelectorAll("[aria-label]")].map((element) =>
    element.getAttribute("aria-label"),
  );

describe("QueuedRunsControl automatic completion delivery", () => {
  it("does not render a queue control when only hidden delivery remains", async () => {
    setup();
    state.workflow = {
      activeRun: { id: "run:active" },
      canPromoteToSteer: true,
      queuedRuns: [],
    };

    await using screen = await renderQueue();

    expect(screen.container.childElementCount).toBe(0);
  });
});

describe("QueuedRunsControl attachments and edit mode", () => {
  const workflowWithAttachment = () => ({
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Queued with a screenshot",
        attachments: [
          {
            type: "image",
            id: "attachment-1",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 128,
          },
        ],
      },
    ],
  });

  it("renders an attachment thumbnail on the queued row", async () => {
    setup();
    state.workflow = workflowWithAttachment();

    await using screen = await renderQueue();

    expect(screen.container.querySelector("img")?.getAttribute("src")).toBe(
      "https://assets.test/attachment-1",
    );
    expect(screen.container.textContent).toContain("Queued with a screenshot");
    expect(labels(screen.container)).toContain("Edit queued message");
    expect(labels(screen.container).some((label) => label?.startsWith("Reorder"))).toBe(false);
    expect(screen.container.querySelector("[draggable='true']")).toBeNull();
  });

  it("keeps the original queued message visible while editing", async () => {
    setup();
    state.workflow = workflowWithAttachment();

    await using screen = await renderQueue({ editingRunId: "run:queued" as never });

    expect(screen.container.textContent).toContain("Queued with a screenshot");
  });
});

describe("QueuedRunsControl send", () => {
  it("starts a held message as a new turn once the agent is stopped", async () => {
    setup();
    state.workflow = {
      activeRun: null,
      canSendNow: true,
      canPromoteToSteer: false,
      queuedRuns: [
        { run: { id: "run:held", userMessageId: "message:held" }, text: "Held", attachments: [] },
      ],
    };
    const ref = createRef<QueuedRunsControlHandle>();

    await using _screen = await renderQueue({ ref });
    await expect.element(page.getByRole("button", { name: "Send now" })).toBeEnabled();
    await act(async () => {
      ref.current?.steerNext(false);
    });

    expect(state.commands).toEqual([
      {
        command: threadEnvironment.resumeThreadQueue,
        input: {
          environmentId: "environment:test",
          input: { threadId: "thread:test", runId: "run:held" },
        },
      },
    ]);
  });
});

describe("QueuedRunsControl editLatest", () => {
  const queuedRun = (id: string, text: string) => ({
    run: { id: `run:${id}`, userMessageId: `message:${id}` },
    text,
    attachments: [],
  });

  it("edits the newest queued message", async () => {
    state.workflow = {
      activeRun: { id: "run:active" },
      canPromoteToSteer: true,
      queuedRuns: [queuedRun("first", "first"), queuedRun("second", "second")],
    };
    const ref = createRef<QueuedRunsControlHandle>();
    const onEditQueuedRun = vi.fn();

    await using _screen = await renderQueue({ ref, onEditQueuedRun });
    let handled = false;
    await act(async () => {
      handled = ref.current?.editLatest(false) ?? false;
    });

    expect(handled).toBe(true);
    expect(onEditQueuedRun).toHaveBeenCalledWith({
      runId: "run:second",
      messageId: "message:second",
      text: "second",
      attachments: [],
    });
  });

  it("leaves the key alone when nothing is queued", async () => {
    state.workflow = {
      activeRun: null,
      canPromoteToSteer: false,
      queuedRuns: [],
    };
    const ref = createRef<QueuedRunsControlHandle>();

    await using _screen = await renderQueue({ ref });

    expect(ref.current?.editLatest(false)).toBe(false);
  });
});

it("previews assistant quotes as readable text and preserves the citation when editing", async () => {
  setup();
  const quotedText = "Cache the parsed config per worktree.";
  const quote = serializeAssistantCitation({
    version: 1,
    environmentId: EnvironmentId.make("environment:test"),
    threadId: ThreadId.make("thread:test"),
    messageId: MessageId.make("message:assistant"),
    text: quotedText,
    start: 0,
    end: quotedText.length,
    prefix: "",
    suffix: "",
  });
  const quoteAndText = `${quote}\n\nWhy per worktree?`;
  const inlineImage = formatComposerContextReference({
    kind: "image",
    contextId: toComposerContextId("header"),
    label: "header.png",
  });
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      {
        run: { id: "run:quote-only", userMessageId: "message:quote-only" },
        text: quote,
        attachments: [],
      },
      {
        run: { id: "run:quote-and-text", userMessageId: "message:quote-and-text" },
        text: quoteAndText,
        attachments: [],
      },
      {
        run: { id: "run:inline-image", userMessageId: "message:inline-image" },
        text: `Make the header look like ${inlineImage} and keep the logo.`,
        attachments: [{ type: "image", id: "attachment:header", name: "header.png" }],
      },
    ],
  };
  const onEditQueuedRun = vi.fn();
  await using _screen = await renderQueue({ onEditQueuedRun });

  await expect.element(page.getByText(quotedText, { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(`${quotedText} Why per worktree?`, { exact: true }))
    .toBeVisible();
  await expect
    .element(
      page.getByText("Make the header look like header.png and keep the logo.", { exact: true }),
    )
    .toBeVisible();

  await page.getByRole("button", { name: "Edit queued message", exact: true }).nth(1).click();
  expect(onEditQueuedRun).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ text: quoteAndText }),
  );
});

it("names who sent each queued message and opens the sender", async () => {
  setup();
  const message = (id: string, fields: Record<string, unknown>) => ({
    id,
    role: "user",
    ...fields,
  });
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      [
        "run:automation",
        "GitHub labeled a pull request.\nFollow the runbook.",
        {
          createdBy: "agent",
          scheduledTaskId: "task:webhook",
        },
      ],
      [
        "run:agent",
        "Review finished.",
        {
          createdBy: "agent",
          creationSource: "provider",
          senderThreadId: "thread:lead",
        },
      ],
      [
        "run:server",
        "Continue where you left off.",
        {
          createdBy: "agent",
          creationSource: "server",
        },
      ],
    ].map(([runId, text, fields]) => ({
      run: { id: runId, userMessageId: `${runId}:message` },
      text,
      attachments: [],
      message: message(`${runId}:message`, { text, ...(fields as object) }),
    })),
  };
  const onOpenThread = vi.fn();
  await using _screen = await renderQueue({ onOpenThread });

  await expect
    .element(page.getByRole("link", { name: "Open automation PR dispatcher" }))
    .toHaveAttribute("href", expect.stringContaining("taskId=task%3Awebhook"));
  await expect.element(page.getByText(/Follow the runbook/)).toBeInTheDocument();

  await page.getByRole("button", { name: "Open thread Release lead" }).click();
  expect(onOpenThread).toHaveBeenCalledExactlyOnceWith("thread:lead");

  await expect.element(page.getByText("Supaterm", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Continue where you left off.")).toBeVisible();
});

it("does not re-render while assistant text streams into the thread", async () => {
  setup();
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    canReorder: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Run the tests next",
        attachments: [],
      },
    ],
  };
  const base = makeThreadProjectionFixture();
  // Each delta replaces only the streaming reply; every other item keeps its identity.
  const timeline = makeStreamingTimelineFixture().visibleTurnItems;
  const thread = (text: string, done = false) => {
    const items = timeline.map((entry) =>
      entry.item.type === "assistant_message" && entry.item.streaming
        ? {
            ...entry,
            item: done
              ? { ...entry.item, text, streaming: false, status: "completed" as const }
              : { ...entry.item, text },
          }
        : entry,
    );
    return AsyncResult.success<EnvironmentThreadState>({
      ...EMPTY_ENVIRONMENT_THREAD_STATE,
      data: Option.some({
        ...base,
        turnItems: items.map(({ item }) => item),
        visibleTurnItems: items,
      }),
    });
  };
  const registry = AtomRegistry.make();
  await using stack = new AsyncDisposableStack();
  stack.defer(() => registry.dispose());
  registry.set(state.threadState, thread("Hel"));
  let renders = 0;
  await using _screen = await renderUi(
    <RegistryContext.Provider value={registry}>
      <Profiler id="queue" onRender={() => (renders += 1)}>
        <QueuedRunsControl {...baseProps} />
      </Profiler>
    </RegistryContext.Provider>,
  );
  await expect.element(page.getByText("Run the tests next", { exact: true })).toBeVisible();
  const settled = renders;

  await act(() => registry.set(state.threadState, thread("Hello")));
  await act(() => registry.set(state.threadState, thread("Hello there")));
  expect(renders).toBe(settled);

  await act(() => registry.set(state.threadState, thread("Hello there", true)));
  expect(renders).toBeGreaterThan(settled);
});

it("tells the user why Send now was rejected", async () => {
  setup();
  const reason = "Target run run:active is stopping and cannot be steered.";
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Follow up",
        attachments: [],
      },
    ],
  };
  state.commandResult = AsyncResult.failure(
    Cause.fail(
      new OrchestrationV2DispatchCommandError({
        commandId: CommandId.make("command:promote"),
        commandType: "queued-message.promote-to-steer",
        message: reason,
        detail: reason,
      }),
    ),
  );
  await using _screen = await renderUi(
    <ToastProvider timeout={0}>
      <QueuedRunsControl {...baseProps} />
    </ToastProvider>,
  );

  await page.getByRole("button", { name: "Send now" }).click();
  await vi.waitFor(() => expect(page.getByText(reason).element()).toBeVisible());
});
