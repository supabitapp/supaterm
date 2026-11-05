import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  ThreadId,
} from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import type { ChatComposerHandle } from "./ChatComposer";
import { useComposerSend } from "./useComposerSend";

const send = vi.hoisted(() => ({
  events: [] as string[],
  enqueued: [] as unknown[],
  forkError: null as string | null,
}));
vi.mock(import("./useSideChat"), () => ({
  sendSideChatDraftMessage: (async (input: {
    parentRef: { threadId: string };
    targetThreadId: string;
    enqueue: () => Promise<unknown>;
  }) => {
    send.events.push(`fork:${input.parentRef.threadId}->${input.targetThreadId}`);
    if (send.forkError !== null) return { kind: "failed", reason: send.forkError };
    return { kind: "queued", value: await input.enqueue() };
  }) as never,
}));
vi.mock(import("../../chatPanes/paneScope"), async (importOriginal) => ({
  ...(await importOriginal()),
  usePaneThreadNavigation: () => async (target) => {
    send.events.push(`open:${target.kind}`);
  },
}));
vi.mock(import("../../state/threadOutbox"), async (importOriginal) => ({
  ...(await importOriginal()),
  enqueueThreadOutboxTurns: (async (turns: ReadonlyArray<unknown>) => {
    send.events.push("enqueue");
    send.enqueued.push(...turns);
  }) as never,
}));
vi.mock(import("../../state/composerQueue"), async (importOriginal) => ({
  ...(await importOriginal()),
  readCanQueueComposerMessage: () => true,
}));
vi.mock(import("../../hooks/useSettings"), async (importOriginal) => ({
  ...(await importOriginal()),
  useClientSettingsHydrated: () => true,
}));
vi.mock(import("../../state/threadOutboxEditing"), async (importOriginal) => ({
  ...(await importOriginal()),
  captureOutboxAttachments: () => [],
}));

type ComposerSendInput = Parameters<typeof useComposerSend>[0];

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const threadRef = scopeThreadRef(environmentId, threadId);
const routeThreadKey = scopedThreadKey(threadRef);
const approvalId = RuntimeRequestId.make("approval");
const prompt = "Use the other approach";

const sendContext: ReturnType<ChatComposerHandle["getSendContext"]> = {
  answeringPendingUserInput: false,
  shownPendingApprovalIds: [approvalId],
  prompt,
  images: [],
  files: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  referenceContexts: [],
  selectedPromptEffort: null,
  selectedModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
  multipleModelSelections: null,
  providerAvailable: true,
  selectedProvider: ProviderDriverKind.make("codex"),
  selectedModel: "gpt",
  selectedProviderModels: [],
  interactionMode: "default",
};
const composer: Pick<
  ChatComposerHandle,
  "getSendContext" | "hasPendingAttachments" | "resetCursorState" | "validateProviderInput"
> = {
  getSendContext: () => sendContext,
  hasPendingAttachments: () => false,
  resetCursorState: () => {},
  validateProviderInput: () => true,
};

function sendInput(
  onRespondToApproval: ComposerSendInput["onRespondToApproval"],
): ComposerSendInput {
  return {
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef: { current: routeThreadKey },
    draftId: null,
    activeThread: {
      id: threadId,
      environmentId,
      worktreePath: null,
      activeProviderThreadId: null,
    } as never,
    activeThreadKey: routeThreadKey,
    activeThreadBranch: null,
    activeProject: { id: "project", workspaceRoot: "/repo" } as never,
    isServerThread: true,
    isLocalDraftThread: false,
    isGitRepo: true,
    phase: "running",
    runtimeMode: "full-access",
    sendEnvMode: "local",
    startFromOrigin: false,
    worktreeBaseRefsSettled: true,
    localCheckoutBranchMismatch: null,
    logicalProjectEnvironments: [],
    providerInstanceEntries: [],
    composerRef: { current: composer as ChatComposerHandle },
    composerDraftTarget: threadRef,
    promptRef: { current: prompt },
    feedbackUploadsInFlightRef: { current: new Set() },
    queuedRunEdit: { isEditing: false, outbox: { isEditing: false } } as never,
    isRevertingCheckpoint: false,
    threadDetailLoading: false,
    activeEnvironmentUnavailable: false,
    sendQueuesBehindSetup: false,
    isDraftHeroState: false,
    panelAnimationsActive: false,
    panelAnimationDurationMs: 0,
    usageLimitsKey: null,
    usageLimitsOffered: false,
    openUsageLimits: () => false,
    clearUsageLimitsFor: () => {},
    needsLoadBalancing: false,
    loadBalancing: { pending: false } as never,
    readPendingEnvironmentChange: () => null,
    pendingApprovals: [
      {
        requestId: approvalId,
        requestKind: "command",
        createdAt: "2026-10-24T00:00:00.000Z",
        detail: "rm -rf build",
        responseCapability: "live",
      },
    ],
    respondingRequestIds: [],
    activePendingProgress: null,
    onAdvanceActivePendingUserInput: () => {},
    onRespondToApproval,
    beginWorktreeSetup: () => {},
    captureDraftHeroLayout: () => {},
    setDockedDraftHeroThreadKey: () => {},
    setFeedbackSubmissionsByThreadKey: () => {},
    setThreadError: () => {},
    anchorNewTurn: () => {},
    handleNewThreadInActiveProject: () => {},
    sideChatDisabledReason: null,
    sideChatDraftParentRef: null,
  };
}

async function sendOverApproval(decline: "Success" | "Failure") {
  send.events = [];
  send.enqueued = [];
  let onSend: ReturnType<typeof useComposerSend>["onSend"] | undefined;
  function Probe() {
    const current = useComposerSend(
      sendInput(async (requestId, decision) => {
        send.events.push(`${decision}:${requestId}`);
        return decline === "Success"
          ? AsyncResult.success({ sequence: 1 })
          : AsyncResult.fail(new Error("The provider rejected the decline") as never);
      }),
    );
    useLayoutEffect(() => {
      onSend = current.onSend;
    });
    return null;
  }
  await using _screen = await render(<Probe />);
  await act(async () => {
    await onSend?.(undefined, "steer");
  });
}

async function sendFromSideChatDraft() {
  send.events = [];
  send.enqueued = [];
  const errors: Array<string | null> = [];
  let onSend: ReturnType<typeof useComposerSend>["onSend"] | undefined;
  function Probe() {
    const current = useComposerSend({
      ...sendInput(async () => AsyncResult.success({ sequence: 1 })),
      isServerThread: false,
      isLocalDraftThread: true,
      phase: "ready",
      pendingApprovals: [],
      setThreadError: (_threadId, error) => errors.push(error),
      sideChatDraftParentRef: scopeThreadRef(environmentId, ThreadId.make("parent")),
    });
    useLayoutEffect(() => {
      onSend = current.onSend;
    });
    return null;
  }
  await using _screen = await render(<Probe />);
  await act(async () => {
    await onSend?.();
  });
  return errors;
}

describe("useComposerSend from a side chat draft", () => {
  it("forks the parent first, then sends the message to the side chat it opens", async () => {
    send.forkError = null;
    await sendFromSideChatDraft();

    expect(send.events).toEqual([`fork:parent->${threadId}`, "enqueue", "open:server"]);
    expect(send.enqueued).toMatchObject([{ input: { threadId, message: { text: prompt } } }]);
    expect(send.enqueued[0]).not.toHaveProperty("input.bootstrap");
  });

  it("keeps the draft when the fork fails", async () => {
    send.forkError = "Thread parent has no worktree yet.";
    const errors = await sendFromSideChatDraft();

    expect(send.events).toEqual([`fork:parent->${threadId}`]);
    expect(errors).toContain("Thread parent has no worktree yet.");
  });
});

describe("useComposerSend over a pending approval", () => {
  it("declines the shown approval before the message enters the outbox", async () => {
    await sendOverApproval("Success");

    expect(send.events).toEqual([`decline:${approvalId}`, "enqueue"]);
    expect(send.enqueued).toMatchObject([
      { input: { threadId, message: { text: prompt }, dispatchMode: "auto" } },
    ]);
  });

  it("keeps the message out of the outbox when the decline fails", async () => {
    await sendOverApproval("Failure");

    expect(send.events).toEqual([`decline:${approvalId}`]);
  });
});
