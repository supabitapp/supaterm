import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../../composerDraftStore";
import type { PendingThreadTurn } from "../../state/threadOutbox";
import type { ChatComposerHandle } from "./ChatComposer";
import type { EditQueuedRunRequest } from "./QueuedRunsControl";
import { useThreadOutboxEdit } from "./useThreadOutboxEdit";

const outbox = vi.hoisted(() => ({ pause: vi.fn(), replace: vi.fn(), navigate: vi.fn() }));
vi.mock("../../state/threadOutbox", () => ({
  webThreadOutbox: { pause: outbox.pause },
  replaceThreadOutboxTurn: outbox.replace,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => outbox.navigate }));

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
  prompt: "Edited message",
  images: [],
  files: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  threadContexts: [],
  selectedPromptEffort: null,
  selectedModelOptionsForDispatch: undefined,
  selectedModelSelection: editedModel,
  multipleModelSelections: null,
  providerAvailable: true,
  selectedProvider: ProviderDriverKind.make("claudeAgent"),
  selectedModel: "edited-model",
  selectedProviderModels: [],
  interactionMode: "default",
};

let root: Root;
let container: HTMLDivElement;
let edit: ReturnType<typeof useThreadOutboxEdit>;
const queuedRunEdit = { beginEdit: vi.fn(), cancelEdit: vi.fn(), isSaving: false };
const composer = {
  focusAtEnd: vi.fn(),
  resetCursorState: vi.fn(),
  getSendContext: () => sendContext,
};
const setThreadError = vi.fn();

function Probe() {
  const current = useThreadOutboxEdit({
    environmentId,
    routeThreadRef,
    threadId,
    queuedRunEdit,
    promptRef: { current: "Edited message" },
    composerRef: { current: composer },
  });
  useLayoutEffect(() => {
    edit = current;
  }, [current]);
  return null;
}

async function beginOutboxEdit() {
  await act(() => edit.beginEdit(entry));
  expect(edit.isEditing).toBe(true);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  outbox.pause.mockResolvedValue(true);
  outbox.replace.mockResolvedValue(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
  vi.unstubAllGlobals();
});

describe("outbox message editing", () => {
  it("cancels a queued-run edit when an outbox edit starts, and the reverse", async () => {
    await beginOutboxEdit();
    expect(queuedRunEdit.cancelEdit).toHaveBeenCalledOnce();

    const request: EditQueuedRunRequest = {
      runId: RunId.make("run"),
      messageId: MessageId.make("queued"),
      text: "Queued message",
      attachments: [],
    };
    act(() => edit.beginQueuedRunEdit(request));
    expect(edit.isEditing).toBe(false);
    expect(queuedRunEdit.beginEdit).toHaveBeenCalledWith(request);
    expect(outbox.pause).toHaveBeenLastCalledWith(entry.id, false);
  });

  it("does not save while another send is in flight", async () => {
    await beginOutboxEdit();
    await act(() =>
      edit.saveEdit(
        { runtimeMode: "full-access", sendInFlightRef: { current: true } },
        setThreadError,
      ),
    );
    expect(outbox.replace).not.toHaveBeenCalled();
    expect(edit.isEditing).toBe(true);
  });

  it("saves the composer's message and model into the pending message", async () => {
    const savedThread = { environmentId, threadId: ThreadId.make("saved") };
    outbox.replace.mockResolvedValue(savedThread);
    await beginOutboxEdit();
    const sendInFlightRef = { current: false };
    await act(() =>
      edit.saveEdit({ runtimeMode: "approval-required", sendInFlightRef }, setThreadError),
    );
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
    expect(edit.isEditing).toBe(false);
    expect(edit.isSaving).toBe(false);
    expect(sendInFlightRef.current).toBe(false);
  });

  it("keeps the edit open and shows why a save failed", async () => {
    outbox.replace.mockRejectedValue(new Error("Delivery has already started."));
    await beginOutboxEdit();
    const sendInFlightRef = { current: false };
    await act(() => edit.saveEdit({ runtimeMode: "full-access", sendInFlightRef }, setThreadError));
    expect(setThreadError).toHaveBeenCalledWith(threadId, "Delivery has already started.");
    expect(edit.isEditing).toBe(true);
    expect(sendInFlightRef.current).toBe(false);
  });
});
