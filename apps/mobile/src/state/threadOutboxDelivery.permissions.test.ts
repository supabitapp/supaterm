import {
  AuthOrchestrationOperateScope,
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@supaterm/contracts";
import { attachmentUploadError } from "@supaterm/client-runtime/state/attachment-uploads";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import { AsyncResult, type Atom } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { threadOutboxRetryDelayMs, type QueuedThreadMessage } from "./thread-outbox-model";

const state = vi.hoisted(() => ({
  draftText: "Keep this draft separate",
  cleanups: [] as Array<() => void>,
  delivery: null as {
    readonly drain: () => void;
    readonly dispose: () => void;
  } | null,
  start: vi.fn(),
  metadata: vi.fn(),
  runtime: vi.fn(),
  interaction: vi.fn(),
  prepare: vi.fn(),
  checkout: vi.fn(),
  modelUnavailable: vi.fn(() => false),
  uploadVoice: vi.fn(),
  audioExists: true,
  releaseRecordings: vi.fn(async () => {}),
  familyMount: vi.fn(() => () => {}),
  threadShells: null as unknown as Atom.Writable<ReadonlyArray<unknown>>,
  manager: null as unknown as ReturnType<
    typeof import("./thread-outbox-manager").createThreadOutboxManager
  >,
  thread: {
    environmentId: "secondary",
    id: "thread",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
  },
  config: {
    shellThreadFamilies: false,
    providers: [{ instanceId: "codex", driver: "codex", models: [] }],
    environment: { capabilities: {} },
  },
}));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
vi.mock("@supaterm/client-runtime/state/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supaterm/client-runtime/state/runtime")>()),
  runAtomCommand: (_registry: unknown, command: (input: unknown) => unknown, input: unknown) =>
    command(input),
}));
vi.mock("./session", async () => {
  const { Atom } = await import("effect/reactivity");
  const { appAtomRegistry } = await import("./atom-registry");
  const sessionStateAtom = Atom.family((_id: string) => Atom.make(false).pipe(Atom.keepAlive));
  const sessionHasScope = (granted: boolean, scope: string) =>
    granted && scope === AuthOrchestrationOperateScope;
  return {
    environmentSession: { sessionStateAtom },
    sessionHasScope,
    readEnvironmentScope: (environmentId: string, scope: string) =>
      sessionHasScope(appAtomRegistry.get(sessionStateAtom(environmentId)), scope),
  };
});
vi.mock("./projects", async () => {
  const { Atom } = await import("effect/reactivity");
  return { environmentProjects: { projectsAtom: Atom.make([]) } };
});
vi.mock("./workspace", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    workspaceConnections: {
      environmentsAtom: Atom.make([{ environmentId: "secondary", connectionState: "connected" }]),
    },
  };
});
vi.mock("./server", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    serverEnvironment: { configValueAtom: Atom.family((_id: string) => Atom.make(state.config)) },
    environmentServerConfigsAtom: Atom.make(new Map([["secondary", state.config]])),
  };
});
vi.mock("./transcription", () => ({ uploadEnvironmentVoiceRecording: state.uploadVoice }));
vi.mock("./thread-outbox-audio", () => ({
  queuedVoiceRecordingFile: async (messageId: string) => ({
    exists: state.audioExists,
    uri: `file:///documents/thread-outbox-audio/${messageId}.wav`,
  }),
  releaseUnusedQueuedVoiceRecordings: state.releaseRecordings,
}));
vi.mock("./threads", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  state.threadShells = Atom.make<ReadonlyArray<unknown>>([state.thread]).pipe(Atom.keepAlive);
  return {
    threadEnvironment: {
      startTurn: state.start,
      updateMetadata: state.metadata,
      setRuntimeMode: state.runtime,
      setInteractionMode: state.interaction,
    },
    environmentThreadShells: { threadShellsAtom: state.threadShells },
    threadFamilies: {
      mount: state.familyMount,
      familyAtom: () => Atom.make(AsyncResult.success({})),
      refresh: vi.fn(),
    },
    environmentThreadDetails: { stateAtom: () => Atom.make(null) },
  };
});
vi.mock("./vcs", () => ({ fetchVcsRefs: vi.fn() }));
vi.mock("./git", () => ({ gitEnvironment: { preparePullRequestThread: state.checkout } }));
vi.mock("../lib/modelOptions", () => ({
  isModelSelectionUnavailable: state.modelUnavailable,
  describeUnavailableModelSelection: () => ({
    title: "Model unavailable",
    detail: "Pick another.",
  }),
}));
vi.mock("../lib/uuid", () => ({ uuidv4: () => "uuid", randomHex: () => "abcd" }));
vi.mock("../lib/attachmentUpload", () => ({ prepareTurnAttachments: state.prepare }));
vi.mock("./composer-attachment-uploads", () => ({ uploadComposerAttachmentShared: vi.fn() }));
vi.mock("./thread-outbox", async () => {
  const { createThreadOutboxManager } = await import("./thread-outbox-manager");
  const { appAtomRegistry } = await import("./atom-registry");
  state.manager = createThreadOutboxManager({
    registry: appAtomRegistry,
    storage: {
      load: async () => ({ messages: [], errors: [] }),
      write: async () => {},
      remove: async () => {},
    },
  });
  return {
    threadOutboxManager: state.manager,
    threadOutboxRevision: (id: MessageId) => state.manager.revisionOf(id),
    confirmThreadOutboxMessageQueued: (message: QueuedThreadMessage) =>
      state.manager.confirmQueued(message),
    updateThreadOutboxMessage: (message: QueuedThreadMessage, revision?: number) =>
      state.manager.update(message, revision),
  };
});
vi.mock("./thread-outbox-removal", () => ({
  removeThreadOutboxMessage: (message: QueuedThreadMessage, revision?: number) =>
    state.manager.remove(message, revision),
}));
vi.mock("./use-thread-outbox", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    editingQueuedMessageIdsAtom: Atom.make({}).pipe(Atom.keepAlive),
    dispatchingQueuedMessageIdsAtom: Atom.make<Readonly<Record<MessageId, true>>>({}).pipe(
      Atom.keepAlive,
    ),
    retryingQueuedMessageIdsAtom: Atom.make({}).pipe(Atom.keepAlive),
    threadOutboxShellStatusesAtom: Atom.make(new Map([["secondary", "live"]])),
  };
});
vi.mock("./use-composer-drafts", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    composerDraftsAtom: Atom.make({}),
    appendComposerDraftAttachments: vi.fn(),
    applyComposerDraftContent: vi.fn((_key: string, input: { text: string }) => {
      state.draftText += `\n${input.text}`;
      return 0;
    }),
    captureComposerDraftMerge: vi.fn((_key: string, merge: () => void) => {
      merge();
      return { snapshot: { text: "", attachments: [] }, merged: { text: "", attachments: [] } };
    }),
    flushComposerDrafts: vi.fn(async () => {}),
    scheduleUnusedComposerAttachmentCleanup: vi.fn(),
    getComposerDraftSnapshot: vi.fn(() => ({ text: state.draftText, attachments: [] })),
    mergeComposerDraftContent: vi.fn(async (_key: string, input: { text: string }) => {
      state.draftText += `\n${input.text}`;
    }),
    replaceComposerDraftAttachments: vi.fn(),
    setFreshSessionPending: vi.fn(),
    undoComposerDraftMerge: vi.fn(async () => {}),
    updateComposerDraftSettings: vi.fn(),
    waitForComposerDraftsLoaded: vi.fn(async () => {}),
  };
});

import { appAtomRegistry } from "./atom-registry";
import { environmentSession } from "./session";
import {
  dispatchingQueuedMessageIdsAtom,
  editingQueuedMessageIdsAtom,
  retryingQueuedMessageIdsAtom,
} from "./use-thread-outbox";

const sendingMessageIds = () => Object.keys(appAtomRegistry.get(dispatchingQueuedMessageIdsAtom));
import { createThreadOutboxDelivery } from "./threadOutboxDelivery";
import { workspaceConnections } from "./workspace";

const message = (overrides: Partial<QueuedThreadMessage> = {}) => ({
  environmentId: EnvironmentId.make("secondary"),
  threadId: ThreadId.make("thread"),
  commandId: CommandId.make("command"),
  messageId: MessageId.make("message"),
  text: "Keep this queued",
  attachments: [],
  createdAt: "2026-09-05T00:00:00.000Z",
  ...overrides,
});
const remaining = () =>
  Object.values(appAtomRegistry.get(state.manager.queuedMessagesByThreadKeyAtom)).flat();

function setOperateGrant(environmentId: string, granted: boolean) {
  const sessionAtom = environmentSession.sessionStateAtom(EnvironmentId.make(environmentId));
  appAtomRegistry.set(sessionAtom as unknown as Atom.Writable<boolean>, granted);
}

function runDrain() {
  const settled = Promise.withResolvers<void>();
  const release = appAtomRegistry.subscribe(dispatchingQueuedMessageIdsAtom, (ids) => {
    if (Object.keys(ids).length === 0) settled.resolve();
  });
  startDelivery();
  return settled.promise.finally(release);
}

function startDelivery() {
  if (state.delivery !== null) {
    state.delivery.drain();
    return;
  }
  const delivery = createThreadOutboxDelivery();
  state.delivery = delivery;
  state.cleanups.push(() => {
    delivery.dispose();
    state.delivery = null;
  });
}

beforeEach(() => {
  setOperateGrant("primary", true);
  setOperateGrant("secondary", false);
  state.draftText = "Keep this draft separate";
  state.config.shellThreadFamilies = false;
  state.modelUnavailable.mockReset().mockReturnValue(false);
  state.uploadVoice.mockReset();
  state.audioExists = true;
  state.releaseRecordings.mockReset().mockResolvedValue(undefined);
  state.familyMount.mockReset().mockReturnValue(() => {});
  appAtomRegistry.set(state.threadShells, [state.thread]);
  appAtomRegistry.set(state.manager.queuedMessagesByThreadKeyAtom, {});
  appAtomRegistry.set(dispatchingQueuedMessageIdsAtom, {});
  appAtomRegistry.set(editingQueuedMessageIdsAtom, {});
  for (const command of [
    state.start,
    state.metadata,
    state.runtime,
    state.interaction,
    state.checkout,
  ]) {
    command.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  }
  state.start.mockResolvedValue(AsyncResult.success({}));
  state.prepare.mockReset().mockImplementation(({ attachments }) =>
    Effect.succeed({
      status: "ready",
      attachments: [],
      draftAttachments: attachments,
      pendingAttachmentIds: [],
    }),
  );
});

describe("queued PR checkout", () => {
  const queuedPullRequest = () =>
    message({
      threadId: ThreadId.make("new-pr-thread"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      creation: {
        projectId: ProjectId.make("project"),
        projectCwd: "/repo",
        workspaceMode: "worktree",
        branch: "fork/feature",
        worktreePath: null,
        pullRequestReference: "https://github.com/acme/repo/pull/123",
      },
    });
  const preparedCheckout = {
    branch: "pr-123",
    worktreePath: "/repo/.supaterm/worktrees/pr-123",
    isOnPullRequestHead: true,
  };

  it("waits for the provider's PR checkout and launches in that worktree", async () => {
    setOperateGrant("secondary", true);
    await state.manager.enqueue(queuedPullRequest());
    const started = Promise.withResolvers<void>();
    const checkout =
      Promise.withResolvers<AsyncResult.AsyncResult<typeof preparedCheckout, Error>>();
    state.checkout.mockImplementationOnce(() => {
      started.resolve();
      return checkout.promise;
    });
    const drained = runDrain();
    await started.promise;
    expect(state.start).not.toHaveBeenCalled();
    expect(state.checkout).toHaveBeenCalledWith({
      environmentId: "secondary",
      input: { cwd: "/repo", reference: "https://github.com/acme/repo/pull/123", mode: "worktree" },
    });
    checkout.resolve(AsyncResult.success(preparedCheckout));
    await drained;
    expect(state.start).toHaveBeenCalledOnce();
    const bootstrap = state.start.mock.calls[0]?.[0].input.bootstrap;
    expect(bootstrap.createThread).toMatchObject({
      branch: "pr-123",
      worktreePath: preparedCheckout.worktreePath,
    });
    expect(bootstrap.prepareWorktree).toBeUndefined();
    expect(remaining()).toEqual([]);
  });

  it("keeps the PR source queued on a transport failure without starting the agent", async () => {
    setOperateGrant("secondary", true);
    const queued = queuedPullRequest();
    await state.manager.enqueue(queued);
    state.checkout.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Socket is not connected"))),
    );
    await runDrain();
    expect(state.start).not.toHaveBeenCalled();
    expect(remaining()).toEqual([queued]);
  });

  it("restores the PR draft when the reused worktree cannot reach the PR head", async () => {
    setOperateGrant("secondary", true);
    await state.manager.enqueue(queuedPullRequest());
    state.checkout.mockResolvedValueOnce(
      AsyncResult.success({ ...preparedCheckout, isOnPullRequestHead: false }),
    );
    await runDrain();
    expect(state.start).not.toHaveBeenCalled();
    expect(remaining()).toEqual([]);
    const { updateComposerDraftSettings } = await import("./use-composer-drafts");
    expect(updateComposerDraftSettings).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        workspaceSelection: expect.objectContaining({
          pullRequestReference: queuedPullRequest().creation?.pullRequestReference,
        }),
      }),
    );
  });

  it("stops launch if operation access is revoked while checking out the PR", async () => {
    setOperateGrant("secondary", true);
    const queued = queuedPullRequest();
    await state.manager.enqueue(queued);
    state.checkout.mockImplementationOnce(async () => {
      setOperateGrant("secondary", false);
      return AsyncResult.success(preparedCheckout);
    });
    await runDrain();
    expect(state.start).not.toHaveBeenCalled();
    expect(remaining()).toEqual([queued]);
  });

  it("does not launch a stale task edited while the PR checkout was running", async () => {
    setOperateGrant("secondary", true);
    const queued = queuedPullRequest();
    await state.manager.enqueue(queued);
    const edited = { ...queued, text: "Updated instructions" };
    state.checkout.mockImplementationOnce(async () => {
      await state.manager.update(edited);
      return AsyncResult.success(preparedCheckout);
    });
    await runDrain();
    expect(state.start).not.toHaveBeenCalled();
    expect(remaining()).toEqual([edited]);
  });
});
afterEach(() => {
  state.cleanups.splice(0).forEach((cleanup) => cleanup());
});

describe("queued task operation access", () => {
  it("parks a connected read-only target, then delivers its unchanged queue after a grant", async () => {
    const queued = message();
    await state.manager.enqueue(queued);
    startDelivery();
    expect(state.start).not.toHaveBeenCalled();
    expect(state.prepare).not.toHaveBeenCalled();
    expect(remaining()).toEqual([queued]);
    setOperateGrant("secondary", true);
    await runDrain();
    expect(state.start).toHaveBeenCalledOnce();
    expect(remaining()).toEqual([]);
  });

  it("backs off instead of redelivering at once when a delivery hits a defect", async () => {
    setOperateGrant("secondary", true);
    const queued = message();
    await state.manager.enqueue(queued);
    state.modelUnavailable.mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined");
    });
    await runDrain();
    expect(state.modelUnavailable).toHaveBeenCalledOnce();
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
    expect(sendingMessageIds()).toEqual([]);
    expect(remaining()).toEqual([queued]);
  });

  it("starts one delivery when mounting a thread family changes the rows mid-pass", async () => {
    setOperateGrant("secondary", true);
    state.config.shellThreadFamilies = true;
    const subAgentThread = { ...state.thread, id: "sub-agent" };
    state.familyMount.mockImplementationOnce(() => {
      appAtomRegistry.set(state.threadShells, [state.thread, subAgentThread]);
      return () => {};
    });
    const queued = message({ threadId: ThreadId.make("sub-agent") });
    startDelivery();
    appAtomRegistry.set(editingQueuedMessageIdsAtom, { [queued.messageId]: "editing" });
    await state.manager.enqueue(queued);
    const delivered = Promise.withResolvers<void>();
    const release = appAtomRegistry.subscribe(dispatchingQueuedMessageIdsAtom, (ids) => {
      if (Object.keys(ids).length === 0) delivered.resolve();
    });
    appAtomRegistry.set(editingQueuedMessageIdsAtom, {});
    await delivered.promise.finally(release);
    expect(state.familyMount).toHaveBeenCalledOnce();
    expect(state.prepare).toHaveBeenCalledOnce();
    expect(state.start).toHaveBeenCalledOnce();
    expect(remaining()).toEqual([]);
  });

  it("stops the remaining settings and turn commands when an earlier update loses access", async () => {
    setOperateGrant("secondary", true);
    const queued = message({
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "different-model" },
      runtimeMode: "approval-required",
      interactionMode: "plan",
    });
    await state.manager.enqueue(queued);
    state.runtime.mockImplementationOnce(async () => {
      setOperateGrant("secondary", false);
      return AsyncResult.success(undefined);
    });
    await runDrain();
    expect(state.runtime).toHaveBeenCalledOnce();
    expect(state.interaction).not.toHaveBeenCalled();
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
    expect(remaining()).toEqual([queued]);
  });

  it.each([
    { isCreation: false, accepted: false },
    { isCreation: true, accepted: false },
    { isCreation: false, accepted: true },
    { isCreation: true, accepted: true },
  ])(
    "preserves a rejected queue but removes an accepted turn after access loss (new task: $isCreation, accepted: $accepted)",
    async ({ isCreation, accepted }) => {
      setOperateGrant("secondary", true);
      const queued = message(
        isCreation
          ? {
              threadId: ThreadId.make("new-thread"),
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
              creation: {
                projectId: ProjectId.make("project"),
                projectCwd: "/repo",
                workspaceMode: "local",
                branch: null,
                worktreePath: null,
              },
            }
          : {},
      );
      await state.manager.enqueue(queued);
      const started = Promise.withResolvers<void>();
      const delivery =
        Promise.withResolvers<AsyncResult.AsyncResult<{ readonly sequence?: number }, Error>>();
      state.start.mockImplementationOnce(() => {
        started.resolve();
        return delivery.promise;
      });
      const drained = runDrain();
      await started.promise;
      setOperateGrant("secondary", false);
      delivery.resolve(
        accepted
          ? AsyncResult.success({})
          : AsyncResult.failure(Cause.fail(new Error("This connection cannot control this task."))),
      );
      await drained;

      expect(remaining()).toEqual(accepted ? [] : [queued]);
      expect(state.draftText).toBe("Keep this draft separate");
      if (!accepted) {
        setOperateGrant("secondary", true);
        await runDrain();
        expect(state.start).toHaveBeenCalledTimes(2);
        expect(remaining()).toEqual([]);
        expect(state.draftText).toBe("Keep this draft separate");
      }
    },
  );

  it.each([
    { isCreation: false, uploadFails: false },
    { isCreation: true, uploadFails: false },
    { isCreation: false, uploadFails: true },
    { isCreation: true, uploadFails: true },
  ])(
    "keeps the message queued after upload revocation (new task: $isCreation, upload fails: $uploadFails)",
    async ({ isCreation, uploadFails }) => {
      setOperateGrant("secondary", true);
      const queued = message(
        isCreation
          ? {
              threadId: ThreadId.make("new-thread"),
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
              creation: {
                projectId: ProjectId.make("project"),
                projectCwd: "/repo",
                workspaceMode: "local",
                branch: null,
                worktreePath: null,
              },
            }
          : {},
      );
      await state.manager.enqueue(queued);
      state.prepare.mockImplementationOnce(({ attachments }) =>
        Effect.suspend(() => {
          setOperateGrant("secondary", false);
          return uploadFails
            ? Effect.fail(
                attachmentUploadError(new Error("This connection cannot upload attachments.")),
              )
            : Effect.succeed({
                status: "ready",
                attachments: [],
                draftAttachments: attachments,
                pendingAttachmentIds: [],
              });
        }),
      );
      await runDrain();
      expect(state.prepare).toHaveBeenCalledOnce();
      expect(state.start).not.toHaveBeenCalled();
      expect(remaining()).toEqual([queued]);
    },
  );
});

describe("queued task whose launch reply is lost", () => {
  const queuedTask = (creation: Partial<NonNullable<QueuedThreadMessage["creation"]>> = {}) =>
    message({
      threadId: ThreadId.make("new-thread"),
      text: "My dictated idea",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      creation: {
        projectId: ProjectId.make("project"),
        projectCwd: "/repo",
        workspaceMode: "local",
        branch: null,
        worktreePath: null,
        ...creation,
      },
    });

  async function loseLaunchReply(queued: QueuedThreadMessage, edit?: string) {
    setOperateGrant("secondary", true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    state.cleanups.push(() => vi.useRealTimers());
    await state.manager.enqueue(queued);
    state.start.mockImplementationOnce(async () => {
      if (edit !== undefined) await state.manager.update({ ...queued, text: edit });
      return AsyncResult.failure(Cause.fail(new Error("Socket is not connected")));
    });
    await runDrain();
    expect(remaining()).toHaveLength(1);
    appAtomRegistry.set(state.threadShells, [state.thread, { ...state.thread, id: "new-thread" }]);
  }

  async function fireRetry() {
    const settled = Promise.withResolvers<void>();
    const release = appAtomRegistry.subscribe(dispatchingQueuedMessageIdsAtom, (ids) => {
      if (Object.keys(ids).length === 0) settled.resolve();
    });
    vi.advanceTimersByTime(threadOutboxRetryDelayMs(1));
    await settled.promise.finally(release);
  }

  it("resends an unedited launch instead of handing its text back", async () => {
    await loseLaunchReply(queuedTask());
    await fireRetry();

    expect(state.draftText).toBe("Keep this draft separate");
    const [first, resent] = state.start.mock.calls.map(([call]) => call.input);
    expect(state.start).toHaveBeenCalledTimes(2);
    expect(resent.commandId).toBe(first.commandId);
    expect(resent.message.messageId).toBe(first.message.messageId);
    expect(remaining()).toEqual([]);
  });

  it("hands back a task edited while its launch was in flight", async () => {
    await loseLaunchReply(queuedTask(), "Edited idea");
    await fireRetry();

    expect(state.draftText).toBe("Keep this draft separate\nEdited idea");
    expect(state.start).toHaveBeenCalledOnce();
    expect(remaining()).toEqual([]);
  });

  it("holds the resend while operation access is missing", async () => {
    await loseLaunchReply(queuedTask());
    setOperateGrant("secondary", false);
    vi.advanceTimersByTime(threadOutboxRetryDelayMs(1));
    expect(sendingMessageIds()).toEqual([]);
    expect(state.start).toHaveBeenCalledOnce();
    expect(remaining()).toHaveLength(1);

    setOperateGrant("secondary", true);
    await runDrain();
    expect(state.start).toHaveBeenCalledTimes(2);
    expect(state.draftText).toBe("Keep this draft separate");
    expect(remaining()).toEqual([]);
  });

  it("resends a pull request task in its launched worktree without checking out again", async () => {
    state.checkout.mockResolvedValueOnce(
      AsyncResult.success({
        branch: "pr-123",
        worktreePath: "/repo/.supaterm/worktrees/pr-123",
        isOnPullRequestHead: true,
      }),
    );
    await loseLaunchReply(
      queuedTask({
        workspaceMode: "worktree",
        branch: "fork/feature",
        pullRequestReference: "https://github.com/acme/repo/pull/123",
      }),
    );
    await fireRetry();

    expect(state.checkout).toHaveBeenCalledOnce();
    const [first, resent] = state.start.mock.calls.map(([call]) => call.input);
    expect(resent.bootstrap.createThread.worktreePath).toBe("/repo/.supaterm/worktrees/pr-123");
    expect(resent.bootstrap).toEqual(first.bootstrap);
    expect(remaining()).toEqual([]);
  });
});

describe("queued delivery timing", () => {
  async function deliveryAfter(change: () => void) {
    const started = Promise.withResolvers<void>();
    const settled = Promise.withResolvers<void>();
    const release = appAtomRegistry.subscribe(dispatchingQueuedMessageIdsAtom, (ids) => {
      if (Object.keys(ids).length > 0) started.resolve();
      else settled.resolve();
    });
    change();
    await started.promise;
    await settled.promise.finally(release);
  }

  it("starts a thread's next message only after its interrupted send has finished", async () => {
    setOperateGrant("secondary", true);
    const firstStarted = Promise.withResolvers<void>();
    const finishFirst = Promise.withResolvers<AsyncResult.AsyncResult<object, never>>();
    state.start.mockImplementationOnce(async () => {
      firstStarted.resolve();
      return finishFirst.promise;
    });
    const first = message();
    await state.manager.enqueue(first);
    startDelivery();
    await firstStarted.promise;
    await state.manager.remove(first);
    const allDelivered = Promise.withResolvers<void>();
    const release = appAtomRegistry.subscribe(state.manager.queuedMessagesByThreadKeyAtom, () => {
      if (remaining().length === 0) allDelivered.resolve();
    });
    await state.manager.enqueue(
      message({ messageId: MessageId.make("next"), commandId: CommandId.make("next-command") }),
    );
    expect(sendingMessageIds()).toEqual(["message"]);
    expect(state.start).toHaveBeenCalledOnce();
    finishFirst.resolve(AsyncResult.success({}));
    await allDelivered.promise.finally(release);
    expect(state.start).toHaveBeenCalledTimes(2);
  });

  it("sends another thread's message while one thread's send is still running", async () => {
    setOperateGrant("secondary", true);
    const other = { ...state.thread, id: "other" };
    appAtomRegistry.set(state.threadShells, [state.thread, other]);
    const slowStarted = Promise.withResolvers<void>();
    const finishSlow = Promise.withResolvers<AsyncResult.AsyncResult<object, never>>();
    state.start.mockImplementation(async ({ input }: { input: { threadId: string } }) => {
      if (input.threadId !== "thread") return AsyncResult.success({});
      slowStarted.resolve();
      return finishSlow.promise;
    });
    const queuedBecomes = (ids: ReadonlyArray<string>) => {
      const reached = Promise.withResolvers<void>();
      const release = appAtomRegistry.subscribe(state.manager.queuedMessagesByThreadKeyAtom, () => {
        if (
          remaining()
            .map((queued) => queued.messageId)
            .join() === ids.join()
        ) {
          reached.resolve();
        }
      });
      return reached.promise.finally(release);
    };
    await state.manager.enqueue(message());
    startDelivery();
    await slowStarted.promise;
    const otherDelivered = queuedBecomes(["message"]);
    await state.manager.enqueue(
      message({
        threadId: ThreadId.make("other"),
        messageId: MessageId.make("other-message"),
        commandId: CommandId.make("other-command"),
      }),
    );
    await otherDelivered;
    const allDelivered = queuedBecomes([]);
    finishSlow.resolve(AsyncResult.success({}));
    await allDelivered;
    expect(state.start).toHaveBeenCalledTimes(2);
  });

  it("sends at once when its environment reconnects instead of waiting out the backoff", async () => {
    setOperateGrant("secondary", true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    state.cleanups.push(() => vi.useRealTimers());
    const environments = workspaceConnections.environmentsAtom as unknown as Atom.Writable<
      ReadonlyArray<{ environmentId: string; connectionState: string }>
    >;
    const connected = [{ environmentId: "secondary", connectionState: "connected" }];
    state.cleanups.push(() => appAtomRegistry.set(environments, connected));
    await state.manager.enqueue(message());
    state.start.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Socket is not connected"))),
    );
    await runDrain();
    expect(state.start).toHaveBeenCalledOnce();

    appAtomRegistry.set(environments, [
      { environmentId: "secondary", connectionState: "disconnected" },
    ]);
    await deliveryAfter(() => appAtomRegistry.set(environments, connected));
    expect(state.start).toHaveBeenCalledTimes(2);
    expect(remaining()).toEqual([]);
  });
});

describe("queued voice messages in the delivery fiber", () => {
  const voiceMessage = (overrides: Partial<QueuedThreadMessage> = {}) =>
    message({
      messageId: MessageId.make("voice"),
      commandId: CommandId.make("voice-command"),
      text: "",
      dispatchMode: "queue",
      voice: { durationMs: 3_000, sizeBytes: 96_044, language: "en-US" },
      ...overrides,
    });
  const sent = { text: "ship it", submission: { status: "sent", sequence: 4 } };

  it("uploads a queued recording for the environment to send, then retires the message", async () => {
    setOperateGrant("secondary", true);
    const uploadStarted = Promise.withResolvers<void>();
    const finishUpload = Promise.withResolvers<typeof sent>();
    state.uploadVoice.mockImplementationOnce(async () => {
      uploadStarted.resolve();
      return finishUpload.promise;
    });
    const queued = voiceMessage();
    await state.manager.enqueue(queued);
    const delivered = runDrain();
    await uploadStarted.promise;
    expect(sendingMessageIds()).toEqual(["voice"]);
    finishUpload.resolve(sent);
    await delivered;

    expect(state.uploadVoice).toHaveBeenCalledExactlyOnceWith({
      environmentId: queued.environmentId,
      uri: "file:///documents/thread-outbox-audio/voice.wav",
      request: {
        sizeBytes: 96_044,
        language: "en-US",
        submit: {
          threadId: queued.threadId,
          commandId: queued.commandId,
          messageId: queued.messageId,
          modelSelection: state.thread.modelSelection,
          delivery: "queue",
          creationSource: "mobile",
        },
      },
    });
    expect(state.start).not.toHaveBeenCalled();
    expect(remaining()).toEqual([]);
  });

  it("starts a fresh session for a recording queued while /clear was armed", async () => {
    setOperateGrant("secondary", true);
    state.uploadVoice.mockResolvedValueOnce(sent);
    await state.manager.enqueue(voiceMessage({ freshContext: true }));
    await runDrain();
    expect(state.uploadVoice.mock.calls[0]?.[0].request.submit.freshContext).toBe(true);
    expect(remaining()).toEqual([]);
  });

  it("holds a refused recording and keeps the thread's later messages waiting", async () => {
    setOperateGrant("secondary", true);
    const { VoiceUploadError } = await import("@supaterm/client-runtime/state/transcription");
    state.uploadVoice.mockRejectedValueOnce(
      new VoiceUploadError("signedOut", "Sign in to this provider again to transcribe.", false),
    );
    const queued = voiceMessage();
    await state.manager.enqueue(queued);
    await runDrain();
    const later = message({
      messageId: MessageId.make("later"),
      commandId: CommandId.make("later-command"),
      createdAt: "2026-09-05T00:00:01.000Z",
    });
    await state.manager.enqueue(later);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "Date"] });
    state.cleanups.push(() => vi.useRealTimers());
    startDelivery();
    await vi.runAllTimersAsync();

    const [held, waiting] = remaining();
    expect(held).toMatchObject({
      messageId: queued.messageId,
      voice: queued.voice,
      failure: "Sign in to this provider again to transcribe.",
    });
    expect(held?.commandId).not.toBe(queued.commandId);
    expect(waiting).toEqual(later);
    expect(state.uploadVoice).toHaveBeenCalledOnce();
    expect(state.start).not.toHaveBeenCalled();
    expect(sendingMessageIds()).toEqual([]);
    expect(state.releaseRecordings).not.toHaveBeenCalled();
  });

  it("holds a recording whose model is unavailable instead of restoring it to the draft", async () => {
    setOperateGrant("secondary", true);
    state.modelUnavailable.mockReturnValue(true);
    await state.manager.enqueue(voiceMessage());
    await runDrain();
    expect(state.uploadVoice).not.toHaveBeenCalled();
    expect(remaining()[0]).toMatchObject({
      failure: "Model unavailable. Pick another.",
      voice: { sizeBytes: 96_044 },
    });
    expect(state.draftText).toBe("Keep this draft separate");
  });

  it("backs off after a dropped upload and sends the same recording on the retry", async () => {
    setOperateGrant("secondary", true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    state.cleanups.push(() => vi.useRealTimers());
    const { VoiceUploadError } = await import("@supaterm/client-runtime/state/transcription");
    state.uploadVoice
      .mockRejectedValueOnce(
        new VoiceUploadError("disconnected", "The recording couldn't reach the environment.", true),
      )
      .mockResolvedValueOnce(sent);
    const queued = voiceMessage();
    await state.manager.enqueue(queued);
    await runDrain();
    expect(remaining()).toEqual([queued]);
    expect(appAtomRegistry.get(retryingQueuedMessageIdsAtom)).toEqual({ voice: true });

    const settled = Promise.withResolvers<void>();
    const release = appAtomRegistry.subscribe(dispatchingQueuedMessageIdsAtom, (ids) => {
      if (Object.keys(ids).length === 0) settled.resolve();
    });
    vi.advanceTimersByTime(threadOutboxRetryDelayMs(1));
    await settled.promise.finally(release);
    expect(state.uploadVoice).toHaveBeenCalledTimes(2);
    expect(state.uploadVoice.mock.calls[1]?.[0].request.submit.commandId).toBe(queued.commandId);
    expect(remaining()).toEqual([]);
  });

  it("keeps a transcript the thread refused as held text and releases the recording", async () => {
    setOperateGrant("secondary", true);
    state.uploadVoice.mockResolvedValueOnce({ text: "ship it", submission: { status: "failed" } });
    await state.manager.enqueue(voiceMessage());
    await runDrain();
    const [held] = remaining();
    expect(held).toMatchObject({ messageId: "voice", text: "ship it" });
    expect(held?.voice).toBeUndefined();
    expect(held?.failure).toBeDefined();
    expect(state.releaseRecordings).toHaveBeenCalledOnce();
  });
});
