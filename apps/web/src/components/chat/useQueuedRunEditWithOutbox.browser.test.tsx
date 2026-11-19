import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import { useLayoutEffect } from "react";
import { act, render as renderUi, type Screen } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../../composerDraftStore";
import type { PendingThreadTurn } from "../../state/threadOutbox";
import type { ChatComposerHandle } from "./ChatComposer";
import type { EditQueuedRunRequest } from "./QueuedRunsControl";
import { useQueuedRunEditWithOutbox } from "./useQueuedRunEditWithOutbox";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const outbox = vi.hoisted(() => ({
  pause: fake(),
  replace: fake(),
  navigate: fake(),
  queued: {
    editingRunId: null,
    isEditing: false,
    isSaving: false,
    draftTarget: null as ScopedThreadRef | null,
    editingAttachments: null,
    beginEdit: fake(),
    cancelEdit: fake(),
    removeEditingAttachment: fake(),
    saveEdit: fake(),
  },
}));
vi.mock("./useQueuedRunEdit", () => ({ useQueuedRunEdit: () => outbox.queued }));
vi.mock("../../state/threadOutbox", () => ({
  webThreadOutbox: { pause: outbox.pause },
  replaceThreadOutboxTurn: outbox.replace,
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => outbox.navigate) as never,
}));

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const routeThreadRef = scopeThreadRef(environmentId, threadId);
const editedModel = { instanceId: ProviderInstanceId.make("claude"), model: "edited-model" };

const entry: PendingThreadTurn = {
  id: "message",
  scope: "environment:thread",
  createdAt: "2026-10-18T00:00:00Z",
  position: 1,
  status: "pending",
  attempted: false,
  attempts: 0,
  retryAt: 0,
  error: null,
  paused: false,
  pauseUntil: 0,
  payload: {
    environmentId,
    input: {
      commandId: CommandId.make("command"),
      threadId,
      message: {
        messageId: MessageId.make("message"),
        role: "user",
        text: "Original message",
        attachments: [],
      },
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "original-model" },
      runtimeMode: "full-access",
      interactionMode: "default",
      dispatchMode: "queue",
    },
    localAttachments: [],
  },
};

const sendContext: ReturnType<ChatComposerHandle["getSendContext"]> = {
  answeringPendingUserInput: false,
  shownPendingApprovalIds: [],
  prompt: "Edited message",
  images: [],
  files: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  referenceContexts: [],
  selectedPromptEffort: null,
  selectedModelSelection: editedModel,
  multipleModelSelections: null,
  providerAvailable: true,
  selectedProvider: ProviderDriverKind.make("claudeAgent"),
  selectedModel: "edited-model",
  selectedProviderModels: [],
  interactionMode: "default",
};

let screen: Screen;
let edit: ReturnType<typeof useQueuedRunEditWithOutbox>;
const composer: Pick<ChatComposerHandle, "focusAtEnd" | "getSendContext" | "resetCursorState"> = {
  focusAtEnd: vi.fn(),
  resetCursorState: vi.fn(),
  getSendContext: () => sendContext,
};
const setThreadError = vi.fn();
const queuedRequest: EditQueuedRunRequest = {
  runId: RunId.make("run"),
  messageId: MessageId.make("queued"),
  text: "Queued message",
  attachments: [],
};

function Probe() {
  const current = useQueuedRunEditWithOutbox({
    environmentId,
    routeThreadRef,
    threadDraftTarget: routeThreadRef,
    activeThreadId: threadId,
    serverProjection: null,
    promptRef: { current: "Edited message" },
    composerRef: { current: composer as ChatComposerHandle },
  });
  useLayoutEffect(() => {
    edit = current;
  }, [current]);
  return null;
}

const render = () => screen.rerender(<Probe />);

async function beginOutboxEdit() {
  await act(() => edit.outbox.beginEdit(entry));
  expect(edit.outbox.isEditing).toBe(true);
}

async function setupTest() {
  await using resources = new AsyncDisposableStack();
  resources.defer(() => {
    useComposerDraftStore.setState({ draftsByThreadKey: {} });
  });

  vi.clearAllMocks();
  outbox.queued.isSaving = false;
  outbox.queued.draftTarget = routeThreadRef;
  outbox.pause.implement(async () => true);
  outbox.replace.implement(async () => null);
  screen = resources.use(await renderUi(<Probe />, { router: false }));

  return resources.move();
}

describe("queued-run editing with the outbox", () => {
  it("hands the composer to an outbox edit and cancels a queued-run edit", async () => {
    await using _test = await setupTest();
    expect(edit.draftTarget).toBe(routeThreadRef);
    await beginOutboxEdit();
    expect(outbox.queued.cancelEdit).toHaveBeenCalledOnce();
    expect(edit.draftTarget).toBe(`outbox-edit:${scopedThreadKey(routeThreadRef)}:${entry.id}`);
    expect(edit.editingAttachments).toEqual([]);
    expect(edit.removeEditingAttachment).not.toBe(outbox.queued.removeEditingAttachment);
  });

  it("closes the outbox edit and hands the composer back when a queued-run edit starts", async () => {
    await using _test = await setupTest();
    await beginOutboxEdit();
    await act(() => edit.beginEdit(queuedRequest));
    expect(edit.outbox.isEditing).toBe(false);
    expect(outbox.queued.beginEdit).toHaveBeenCalledWith(queuedRequest);
    expect(outbox.pause).toHaveBeenLastCalledWith(entry.id, false);
    expect(edit.draftTarget).toBe(routeThreadRef);
    expect(edit.removeEditingAttachment).toBe(outbox.queued.removeEditingAttachment);
  });

  it("does not save while another send or a queued-run save is in flight", async () => {
    await using _test = await setupTest();
    await beginOutboxEdit();
    await act(() =>
      edit.outbox.saveEdit(
        { runtimeMode: "full-access", sendInFlightRef: { current: true } },
        setThreadError,
      ),
    );
    outbox.queued.isSaving = true;
    await render();
    expect(edit.isSaving).toBe(true);
    await act(() =>
      edit.outbox.saveEdit(
        { runtimeMode: "full-access", sendInFlightRef: { current: false } },
        setThreadError,
      ),
    );
    expect(outbox.replace).not.toHaveBeenCalled();
    expect(edit.outbox.isEditing).toBe(true);
  });

  it("saves the composer's message and model into the pending message", async () => {
    await using _test = await setupTest();
    const savedThread = { environmentId, threadId: ThreadId.make("saved") };
    let finishSave!: (value: typeof savedThread) => void;
    outbox.replace.implement(() => new Promise((resolve) => (finishSave = resolve)));
    await beginOutboxEdit();
    const sendInFlightRef = { current: false };
    let saving!: Promise<void>;
    await act(() => {
      saving = edit.outbox.saveEdit(
        { runtimeMode: "approval-required", sendInFlightRef },
        setThreadError,
      );
    });
    expect(edit.isSaving).toBe(true);
    expect(sendInFlightRef.current).toBe(true);
    await act(async () => {
      finishSave(savedThread);
      await saving;
    });
    expect(outbox.replace).toHaveBeenCalledWith(
      entry,
      expect.objectContaining({
        input: expect.objectContaining({
          modelSelection: editedModel,
          runtimeMode: "approval-required",
          message: expect.objectContaining({ text: "Edited message" }),
        }),
      }),
    );
    expect(setThreadError).toHaveBeenCalledWith(threadId, null);
    expect(outbox.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: savedThread, replace: true }),
    );
    expect(edit.outbox.isEditing).toBe(false);
    expect(edit.isSaving).toBe(false);
    expect(sendInFlightRef.current).toBe(false);
  });

  it("keeps the edit open and shows why a save failed", async () => {
    await using _test = await setupTest();
    outbox.replace.implement(async () =>
      Promise.reject(new Error("Delivery has already started.")),
    );
    await beginOutboxEdit();
    const sendInFlightRef = { current: false };
    await act(() =>
      edit.outbox.saveEdit({ runtimeMode: "full-access", sendInFlightRef }, setThreadError),
    );
    expect(setThreadError).toHaveBeenCalledWith(threadId, "Delivery has already started.");
    expect(edit.outbox.isEditing).toBe(true);
    expect(sendInFlightRef.current).toBe(false);
  });
});
