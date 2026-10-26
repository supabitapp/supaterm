import { EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import { serializeAssistantCitation } from "@supaterm/shared/assistantCitations";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  projection: null as unknown,
  workflow: null as unknown,
  commands: [] as Array<{ command: unknown; input: unknown }>,
}));

vi.mock(import("@supaterm/client-runtime/state/thread-workflows"), async (importOriginal) => ({
  ...(await importOriginal()),
  deriveThreadQueueWorkflowState: (() => state.workflow) as never,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useThreadProjection: (() => state.projection) as never,
}));

vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: ((command: unknown) => async (input: unknown) => {
    state.commands.push({ command, input });
  }) as never,
}));

vi.mock(import("../../assets/assetUrls"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAssetUrls: ((_environmentId: never, resources: ReadonlyArray<{ attachmentId: string }>) =>
    resources.map((resource) => `https://assets.test/${resource.attachmentId}`)) as never,
}));

import { act, render as renderUi } from "../../../test/render";
import { threadEnvironment } from "../../state/threads";
import { QueuedRunsControl, type QueuedRunsControlHandle } from "./QueuedRunsControl";

function setup() {
  state.projection = null;
  state.workflow = null;
  state.commands = [];
}

const baseProps = {
  environmentId: "environment:test" as never,
  optimisticMessages: [],
  threadId: "thread:test" as never,
  editingRunId: null,
  editBlockedReason: null,
  onEditQueuedRun: () => undefined,
  onCancelEdit: () => undefined,
} satisfies ComponentProps<typeof QueuedRunsControl>;

async function renderQueue(props: Partial<ComponentProps<typeof QueuedRunsControl>> = {}) {
  return renderUi(<QueuedRunsControl {...baseProps} {...props} />);
}

const labels = (container: HTMLElement) =>
  [...container.querySelectorAll("[aria-label]")].map((element) =>
    element.getAttribute("aria-label"),
  );

describe("QueuedRunsControl automatic completion delivery", () => {
  it("does not render a queue control when only hidden delivery remains", async () => {
    setup();
    state.projection = {
      projection: {
        messages: [
          {
            delegatedCompletion: {
              parentRunId: "run:parent",
              generation: 1,
              taskIds: ["task:child"],
            },
            id: "message:completion",
          },
        ],
      },
    };
    state.workflow = {
      activeRun: { id: "run:active" },
      canPromoteToSteer: true,
      canReorder: true,
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
    canReorder: true,
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
    state.projection = { projection: { messages: [] } };
    state.workflow = workflowWithAttachment();

    await using screen = await renderQueue();

    expect(screen.container.querySelector("img")?.getAttribute("src")).toBe(
      "https://assets.test/attachment-1",
    );
    expect(screen.container.textContent).toContain("Queued with a screenshot");
    expect(labels(screen.container)).toContain("Edit queued message");
    expect(labels(screen.container)).toContain(
      "Reorder queued message (drag, or press the arrow keys)",
    );
    expect(labels(screen.container)).not.toContain("Move queued message up");
  });

  it("drops the optimistic pending row once the projection holds its message", async () => {
    setup();
    state.projection = {
      projection: { messages: [{ id: "message:acknowledged", text: "hello" }] },
    };
    state.workflow = {
      activeRun: { id: "run:active" },
      canPromoteToSteer: true,
      canReorder: true,
      queuedRuns: [],
    };

    await using screen = await renderQueue({
      optimisticMessages: [
        {
          id: "message:acknowledged" as never,
          inputIntent: "queued_turn",
          text: "hello",
          attachments: [],
        },
      ],
    });

    expect(screen.container.childElementCount).toBe(0);
  });

  it("keeps the original queued message visible while editing", async () => {
    setup();
    state.projection = { projection: { messages: [] } };
    state.workflow = workflowWithAttachment();

    await using screen = await renderQueue({ editingRunId: "run:queued" as never });

    expect(screen.container.textContent).toContain("Queued with a screenshot");
  });
});

describe("QueuedRunsControl send", () => {
  it("starts a held message as a new turn once the agent is stopped", async () => {
    setup();
    state.projection = { projection: { messages: [] } };
    state.workflow = {
      activeRun: null,
      canSendNow: true,
      canPromoteToSteer: false,
      canReorder: true,
      queuedRuns: [
        { run: { id: "run:held", userMessageId: "message:held" }, text: "Held", attachments: [] },
      ],
    };
    const ref = createRef<QueuedRunsControlHandle>();

    await using _screen = await renderQueue({
      ref,
      optimisticMessages: [
        { id: "message:outbox" as never, inputIntent: "queued_turn", text: "In the outbox" },
      ],
    });
    const sendNow = page.getByRole("button", { name: "Send now" });
    await expect.element(sendNow.nth(0)).toBeEnabled();
    await expect.element(sendNow.nth(1)).toBeDisabled();
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
    state.projection = { projection: { messages: [] } };
    state.workflow = {
      activeRun: { id: "run:active" },
      canPromoteToSteer: true,
      canReorder: true,
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

  it("does not fall back to an older message while the newest is still saving", async () => {
    state.projection = { projection: { messages: [] } };
    state.workflow = {
      activeRun: { id: "run:active" },
      canPromoteToSteer: true,
      canReorder: true,
      queuedRuns: [queuedRun("first", "first")],
    };
    const ref = createRef<QueuedRunsControlHandle>();
    const onEditQueuedRun = vi.fn();

    await using _screen = await renderQueue({
      ref,
      onEditQueuedRun,
      optimisticMessages: [
        { id: "message:saving" as never, inputIntent: "queued_turn", text: "saving" },
      ],
    });
    let handled = false;
    await act(async () => {
      handled = ref.current?.editLatest(false) ?? false;
    });

    expect(handled).toBe(true);
    expect(onEditQueuedRun).not.toHaveBeenCalled();
  });

  it("leaves the key alone when nothing is queued", async () => {
    state.projection = { projection: { messages: [] } };
    state.workflow = {
      activeRun: null,
      canPromoteToSteer: false,
      canReorder: false,
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
  state.projection = { projection: { messages: [] } };
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    canReorder: true,
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
    ],
  };
  const onEditQueuedRun = vi.fn();
  await using _screen = await renderQueue({ onEditQueuedRun });

  await expect.element(page.getByText(quotedText, { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(`${quotedText} Why per worktree?`, { exact: true }))
    .toBeVisible();

  await page.getByRole("button", { name: "Edit queued message", exact: true }).nth(1).click();
  expect(onEditQueuedRun).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ text: quoteAndText }),
  );
});
