import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  PlanId,
  ProviderInstanceId,
  ProjectId,
  ThreadId,
} from "@supaterm/contracts";
import { VOICE_SLOT } from "@supaterm/client-runtime/voice-input";
import type { ThreadOutboxEntry } from "./threadOutboxDelivery";
import { DraftId } from "../composerDraftStore";
import type { OutboxTurn, OutboxTurnVoice } from "./threadOutboxSchema";

const harness = vi.hoisted(() => ({
  records: new Map<string, ThreadOutboxEntry<OutboxTurn>>(),
  run: vi.fn(),
  verify: vi.fn(),
  marked: vi.fn(),
  finalized: vi.fn(),
  online: false,
  existingThread: false,
  archivedThread: false,
  availability: vi.fn(),
  transcribe: vi.fn(),
  park: vi.fn(),
  draftPrompt: "",
  setPrompt: vi.fn(),
}));

vi.mock("../rpc/atomRegistry", async () => {
  const { AtomRegistry } = await import("effect/reactivity");
  const registry = AtomRegistry.make();
  return {
    appAtomRegistry: {
      set: registry.set.bind(registry),
      subscribe: registry.subscribe.bind(registry),
      get: (...args: Parameters<typeof registry.get>) => {
        const atom: unknown = args[0];
        if (typeof atom !== "string") return registry.get(...args);
        if (atom === "presentation")
          return { connection: { phase: harness.online ? "connected" : "offline" } };
        if (atom === "shell") return { status: harness.online ? "live" : "cached" };
        if (atom === "snapshot")
          return {
            archivedThreads: harness.archivedThread ? [{ id: "thread" }] : [],
            threads: harness.existingThread
              ? [
                  {
                    id: "thread",
                    branch: "old",
                    runtimeMode: "approval-required",
                    interactionMode: "plan",
                  },
                ]
              : [],
          };
        return new Map([
          [
            "environment",
            {
              environment: {
                capabilities: {
                  fileAttachments: { maxUploadBytes: 1_000 },
                },
              },
            },
          ],
        ]);
      },
    },
  };
});
vi.mock("./presentation", () => ({
  environmentPresentations: { presentationAtom: () => "presentation" },
}));
vi.mock("./shell", () => ({ environmentShell: { stateValueAtom: () => "shell" } }));
vi.mock("./server", () => ({ environmentServerConfigsAtom: "configs" }));
vi.mock("./threadCommands", () => ({
  directThreadEnvironment: {
    startTurn: { label: "send" },
    updateMetadata: { label: "branch" },
    setRuntimeMode: { label: "runtime" },
    setInteractionMode: { label: "interaction" },
    snapshotAtom: () => "snapshot",
  },
}));
vi.mock("./attachments", () => ({
  attachmentEnvironment: { createUploadUrl: { label: "upload" }, remove: { label: "remove" } },
}));
vi.mock("./assets", () => ({ assetEnvironment: { createUrl: { label: "verify" } } }));
vi.mock("./vcs", () => ({ fetchVcsRefs: { label: "refs" } }));
vi.mock("./session", () => ({
  readPreparedConnection: () => ({ httpBaseUrl: "https://environment.example" }),
}));
vi.mock("../lib/utils", () => ({
  randomUUID: () => "generated-command",
  newThreadId: () => ThreadId.make("replacement-thread"),
}));
vi.mock("../composerDraftStore", () => ({
  DraftId: { make: (id: string) => id },
  markPromotedDraftThreadByRef: harness.marked,
  finalizePromotedDraftThreadByRef: harness.finalized,
  composerTargetKey: (target: { environmentId: string; threadId: string }) =>
    `${target.environmentId}:${target.threadId}`,
  useComposerDraftStore: {
    getState: () => ({
      getComposerDraft: () => ({ prompt: harness.draftPrompt }),
      setPrompt: harness.setPrompt,
    }),
  },
}));
vi.mock("./dictation", () => ({
  readDictationAvailability: (...args: unknown[]) => harness.availability(...args),
}));
vi.mock("../dictation/transcribeClip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dictation/transcribeClip")>()),
  transcribeDictationClip: (...args: unknown[]) => harness.transcribe(...args),
}));
vi.mock("../dictation/pendingClips", () => ({
  parkPendingClip: (...args: unknown[]) => harness.park(...args),
}));
vi.mock("../lib/imageCompression", () => ({
  readFileAsDataUrl: async (file: File) => `data:${file.type};base64,${btoa(await file.text())}`,
}));
vi.mock("@supaterm/client-runtime/state/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supaterm/client-runtime/state/runtime")>()),
  runAtomCommand: (...args: unknown[]) => harness.run(...args),
}));
vi.mock("@supaterm/client-runtime/state/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supaterm/client-runtime/state/attachments")>()),
  verifyPersistedAttachmentUpload: (...args: unknown[]) => harness.verify(...args),
}));
vi.mock("./threadOutboxStorage", () => ({
  browserThreadOutboxStorage: {
    load: async () => [...harness.records.values()],
    write: async (entry: ThreadOutboxEntry<OutboxTurn>) => {
      if (!harness.records.has(entry.id)) return false;
      harness.records.set(entry.id, entry);
      return true;
    },
    writeMany: async (entries: ReadonlyArray<ThreadOutboxEntry<OutboxTurn>>) => {
      for (const entry of entries) harness.records.set(entry.id, entry);
    },
    remove: async (id: string) => {
      harness.records.delete(id);
    },
    withLock: async (_scope: string, action: () => Promise<unknown>) => action(),
  },
}));

function target() {
  return {
    environmentId: EnvironmentId.make("environment"),
    input: {
      commandId: CommandId.make("stable-command"),
      threadId: ThreadId.make("thread"),
      message: {
        messageId: MessageId.make("message"),
        role: "user" as const,
        text: "Saved prompt",
        attachments: [],
      },
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
    },
  };
}

function worktreeTarget() {
  const original = target();
  return {
    ...original,
    pendingWorktree: { projectCwd: "/project", startFromOrigin: true },
    input: {
      ...original.input,
      bootstrap: {
        createThread: {
          projectId: ProjectId.make("project"),
          title: "Offline task",
          modelSelection: original.input.modelSelection,
          runtimeMode: original.input.runtimeMode,
          interactionMode: original.input.interactionMode,
          branch: null,
          worktreePath: null,
          createdAt: "2026-10-09T00:00:00Z",
        },
      },
    },
  };
}

function pendingTaskWithFollowUp() {
  const original = target();
  return [
    {
      ...original,
      input: {
        ...original.input,
        createdAt: "2026-10-06T00:00:00Z",
        bootstrap: {
          createThread: {
            projectId: ProjectId.make("project"),
            title: "Task",
            modelSelection: original.input.modelSelection,
            runtimeMode: original.input.runtimeMode,
            interactionMode: original.input.interactionMode,
            branch: null,
            worktreePath: null,
            createdAt: "2026-10-06T00:00:00Z",
          },
        },
      },
    },
    {
      ...original,
      input: {
        ...original.input,
        commandId: CommandId.make("follow-up-command"),
        message: {
          ...original.input.message,
          messageId: MessageId.make("follow-up"),
          text: "Follow-up",
        },
        dispatchMode: "queue" as const,
        createdAt: "2026-10-06T00:01:00Z",
      },
    },
  ] as const;
}

function voiceTarget(text: string, voice: Partial<ReturnType<typeof recording>> = {}) {
  const original = target();
  return {
    ...original,
    input: { ...original.input, message: { ...original.input.message, text } },
    voice: { ...recording(), ...voice },
  };
}

function recording(): Omit<typeof OutboxTurnVoice.Type, "insertAt"> {
  return {
    clipId: "clip",
    bytes: new Blob(["audio"], { type: "audio/webm" }),
    mimeType: "audio/webm",
    durationMs: 2_000,
    locale: "en-US",
    capturedAt: "2026-10-20T00:00:00Z",
    sourceId: null,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  harness.records.clear();
  harness.online = false;
  harness.existingThread = false;
  harness.archivedThread = false;
  harness.draftPrompt = "";
  harness.availability.mockReturnValue({ kind: "available", source: { id: "codex:codex" } });
  harness.transcribe.mockResolvedValue({ text: "the login bug", sourceId: "codex:codex" });
  harness.park.mockResolvedValue({ id: "parked-clip" });
  harness.run.mockResolvedValue(AsyncResult.success({ sequence: 1 }));
  harness.verify.mockResolvedValue({ status: "verified" });
});

describe("web thread outbox delivery", () => {
  it.each(["default", "current"])(
    "resolves the %s branch for a restored offline worktree",
    async (branchKind) => {
      const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
      await enqueueThreadOutboxTurn(worktreeTarget());
      await webThreadOutbox.drain();
      expect(harness.run).not.toHaveBeenCalled();
      vi.resetModules();
      harness.online = true;
      const expectedBranch = branchKind === "default" ? "origin/main" : "feature/current";
      harness.run.mockImplementation(async (_registry, operation) => {
        if (operation.label === "refs")
          return AsyncResult.success({
            isRepo: true,
            refs: [
              { name: "remote/other", isDefault: false, current: true, isRemote: true },
              { name: "feature/current", isDefault: false, current: true, isRemote: false },
              ...(branchKind === "default"
                ? [{ name: "origin/main", isDefault: true, current: false, isRemote: true }]
                : []),
            ],
          });
        expect(harness.records.get("message")?.payload.pendingWorktree).toBeUndefined();
        expect(harness.records.get("message")?.payload.input.bootstrap).toMatchObject({
          createThread: { branch: expectedBranch },
          prepareWorktree: { baseBranch: expectedBranch },
        });
        return AsyncResult.success({ sequence: 1 });
      });
      await (await import("./threadOutbox")).webThreadOutbox.drain();
      expect(harness.run.mock.calls.map((call) => call[1].label)).toEqual(["refs", "send"]);
      expect(harness.run.mock.calls[0]![2]).toEqual({
        environmentId: "environment",
        input: { cwd: "/project", limit: 100, refresh: true },
      });
      expect(harness.run.mock.calls[1]![2].input).toMatchObject({
        commandId: "stable-command",
        message: {
          messageId: "message",
          text: "Saved prompt",
        },
        bootstrap: {
          createThread: { branch: expectedBranch },
          prepareWorktree: {
            projectCwd: "/project",
            baseBranch: expectedBranch,
            startFromOrigin: true,
          },
          runSetupScript: true,
        },
      });
    },
  );

  it("keeps an explicit worktree base branch without querying refs", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    const { pendingWorktree, ...original } = worktreeTarget();
    await enqueueThreadOutboxTurn({
      ...original,
      input: {
        ...original.input,
        bootstrap: {
          ...original.input.bootstrap,
          prepareWorktree: { ...pendingWorktree, baseBranch: "release" },
        },
      },
    });
    harness.online = true;
    await webThreadOutbox.drain();
    expect(harness.run.mock.calls.map((call) => call[1].label)).toEqual(["send"]);
    expect(harness.run.mock.calls[0]![2].input.bootstrap.prepareWorktree.baseBranch).toBe(
      "release",
    );
  });

  it("retries branch lookup after a disconnect and retains the resolved branch across reload", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn(worktreeTarget());
    harness.online = true;
    harness.run.mockResolvedValueOnce(AsyncResult.fail({ _tag: "RpcClientError" }));
    await webThreadOutbox.drain();
    let saved = harness.records.get("message")!;
    expect(saved.status).toBe("pending");
    expect(saved.payload.pendingWorktree?.projectCwd).toBe("/project");
    harness.records.set("message", { ...saved, retryAt: 0 });
    harness.run
      .mockResolvedValueOnce(
        AsyncResult.success({
          isRepo: true,
          refs: [{ name: "main", isDefault: true, current: false, isRemote: false }],
        }),
      )
      .mockResolvedValueOnce(AsyncResult.fail({ _tag: "RpcClientError" }));
    await webThreadOutbox.drain();
    saved = harness.records.get("message")!;
    expect(saved.status).toBe("pending");
    expect(saved.payload.pendingWorktree).toBeUndefined();
    expect(saved.payload.input.bootstrap?.prepareWorktree?.baseBranch).toBe("main");
    harness.records.set("message", { ...saved, retryAt: 0 });
    vi.resetModules();
    await (await import("./threadOutbox")).webThreadOutbox.drain();
    expect(harness.run.mock.calls.map((call) => call[1].label)).toEqual([
      "refs",
      "refs",
      "send",
      "send",
    ]);
    expect(harness.run.mock.calls[3]![2]).toEqual(harness.run.mock.calls[2]![2]);
  });

  it.each([true, false])(
    "retains a failed worktree when no usable branch exists: isRepo=%s",
    async (isRepo) => {
      const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
      await enqueueThreadOutboxTurn(worktreeTarget());
      harness.online = true;
      harness.run.mockResolvedValueOnce(AsyncResult.success({ isRepo, refs: [] }));
      await webThreadOutbox.drain();
      expect(harness.run.mock.calls.map((call) => call[1].label)).toEqual(["refs"]);
      expect(harness.records.get("message")).toMatchObject({
        status: "failed",
        error: isRepo
          ? "No default or current branch is available. Choose a base branch for this worktree."
          : "This project is not a Git repository. Choose Current checkout to start the task.",
        payload: { pendingWorktree: { projectCwd: "/project" } },
      });
    },
  );

  it.each([undefined, false, true])(
    "delivers legacy compaction-marked prompts without compacting: accepted=%s",
    async (compactAccepted) => {
      const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
      await enqueueThreadOutboxTurn(target());
      const saved = harness.records.get("message")!;
      const legacyPayload = {
        ...saved.payload,
        compactBeforeSend: true,
        compactAccepted,
        input: { ...saved.payload.input, dispatchMode: "queue" as const },
      };
      harness.records.set("message", { ...saved, payload: legacyPayload });
      harness.online = true;

      await webThreadOutbox.drain();

      expect(harness.run).toHaveBeenCalledTimes(1);
      expect(harness.run.mock.calls[0]![2].input).toMatchObject({
        commandId: "stable-command",
        message: { messageId: "message", text: "Saved prompt" },
        dispatchMode: "queue",
      });
      expect(harness.records.size).toBe(0);
    },
  );

  it("retries the saved prompt with stable IDs and without prepending compaction", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn(target());
    harness.online = true;
    harness.run.mockResolvedValueOnce(AsyncResult.fail({ _tag: "RpcClientError" }));
    await webThreadOutbox.drain();
    expect(harness.run).toHaveBeenCalledTimes(1);
    const saved = harness.records.get("message")!;
    harness.records.set("message", { ...saved, retryAt: 0 });

    await webThreadOutbox.drain();

    expect(harness.run).toHaveBeenCalledTimes(2);
    expect(harness.run.mock.calls[1]![2]).toEqual(harness.run.mock.calls[0]![2]);
    expect(harness.run.mock.calls[1]![2].input).toMatchObject({
      commandId: "stable-command",
      message: { messageId: "message", text: "Saved prompt" },
    });
    expect(harness.records.size).toBe(0);
  });

  it.each(["/compact", "/compact Keep the interface decisions"])(
    "delivers the explicit command once: %s",
    async (text) => {
      const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
      const original = target();
      await enqueueThreadOutboxTurn({
        ...original,
        input: {
          ...original.input,
          message: { ...original.input.message, text },
        },
      });
      harness.online = true;

      await webThreadOutbox.drain();

      expect(harness.run).toHaveBeenCalledTimes(1);
      expect(harness.run.mock.calls[0]![2].input.message.text).toBe(text);
      expect(harness.records.size).toBe(0);
    },
  );

  it("persists an edited message with a new command ID before delivering it", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox, replaceThreadOutboxTurn } =
      await import("./threadOutbox");
    await enqueueThreadOutboxTurn(target());
    await webThreadOutbox.pause("message", true);
    const entry = webThreadOutbox.getSnapshot()[0]!;
    await replaceThreadOutboxTurn(entry, {
      ...entry.payload,
      input: {
        ...entry.payload.input,
        message: { ...entry.payload.input.message, text: "Edited in the composer" },
      },
    });
    expect(harness.records.get("message")?.payload.input).toMatchObject({
      commandId: "generated-command",
      message: { messageId: "message", text: "Edited in the composer" },
    });
    expect(harness.records.get("message")?.paused).toBe(false);
    harness.online = true;
    await webThreadOutbox.drain();
    expect(harness.run).toHaveBeenLastCalledWith(
      expect.anything(),
      { label: "send" },
      expect.objectContaining({
        input: expect.objectContaining({
          commandId: "generated-command",
          message: expect.objectContaining({
            messageId: "message",
            text: "Edited in the composer",
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it("applies saved thread settings before delivering a plan follow-up", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    const original = target();
    await enqueueThreadOutboxTurn({
      ...original,
      branch: "main",
      input: {
        ...original.input,
        sourceProposedPlan: { threadId: ThreadId.make("thread"), planId: PlanId.make("plan") },
      },
    });
    harness.existingThread = true;
    harness.online = true;
    await webThreadOutbox.drain();
    expect(harness.run.mock.calls.map((call) => call[1].label)).toEqual([
      "branch",
      "runtime",
      "interaction",
      "send",
    ]);
    expect(harness.run).toHaveBeenLastCalledWith(
      expect.anything(),
      { label: "send" },
      expect.objectContaining({
        input: expect.objectContaining({
          commandId: "stable-command",
          runtimeMode: "full-access",
          interactionMode: "default",
          sourceProposedPlan: { threadId: "thread", planId: "plan" },
        }),
      }),
      expect.anything(),
    );
  });

  it("sends a restored offline message with its original command and message IDs", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn(target());
    await webThreadOutbox.drain();
    expect(harness.run).not.toHaveBeenCalled();
    vi.resetModules();
    const recovered = (await import("./threadOutbox")).webThreadOutbox;
    harness.online = true;
    await recovered.drain();
    expect(harness.run).toHaveBeenCalledWith(
      expect.anything(),
      { label: "send" },
      expect.objectContaining({
        input: expect.objectContaining({
          commandId: "stable-command",
          message: expect.objectContaining({ messageId: "message", text: "Saved prompt" }),
        }),
      }),
      expect.anything(),
    );
    expect(harness.records.size).toBe(0);
  });

  it("persists an uploaded file reference before dispatch and reuses it after a transport failure", async () => {
    harness.online = true;
    const transfer = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", transfer);
    harness.run.mockImplementation(async (_registry: unknown, operation: { label: string }) =>
      operation.label === "upload"
        ? AsyncResult.success({ attachmentId: "uploaded-file", relativeUrl: "/signed-upload" })
        : AsyncResult.fail({ _tag: "RpcClientError" }),
    );
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn({
      ...target(),
      localAttachments: [
        {
          id: "local-file",
          type: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
          bytes: new Blob(["notes"]),
        },
      ],
    });
    await webThreadOutbox.drain();
    const saved = harness.records.get("message");
    expect(saved?.payload.localAttachments[0]?.uploaded?.id).toBe("uploaded-file");
    expect(transfer).toHaveBeenCalledWith(
      "https://environment.example/signed-upload",
      expect.objectContaining({ method: "POST", body: expect.any(Blob) }),
    );
    vi.resetModules();
    harness.run.mockResolvedValue(AsyncResult.success({ sequence: 1 }));
    // Reconnect after the retry backoff without using timers or polling.
    if (!saved) throw new Error("Expected the retained pending message");
    harness.records.set("message", { ...saved, retryAt: 0 });
    await (await import("./threadOutbox")).webThreadOutbox.drain();
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(harness.verify).toHaveBeenCalled();
    expect(harness.run).toHaveBeenLastCalledWith(
      expect.anything(),
      { label: "send" },
      expect.objectContaining({
        input: expect.objectContaining({
          commandId: "stable-command",
          message: expect.objectContaining({
            attachments: [expect.objectContaining({ id: "uploaded-file", type: "file" })],
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it("retains an oversized attachment as a failed pending message", async () => {
    harness.online = true;
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn({
      ...target(),
      localAttachments: [
        {
          id: "file",
          type: "file",
          name: "large.txt",
          mimeType: "text/plain",
          sizeBytes: 1_001,
          bytes: new Blob(["content"]),
        },
      ],
    });
    await webThreadOutbox.drain();
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.records.get("message")?.status).toBe("failed");
    expect(harness.records.get("message")?.payload.localAttachments[0]?.bytes).toBeInstanceOf(Blob);
  });

  it("clears only the removed environment's pending messages", async () => {
    const { enqueueThreadOutboxTurn, clearThreadOutboxEnvironment } =
      await import("./threadOutbox");
    await enqueueThreadOutboxTurn(target());
    const other = target();
    await enqueueThreadOutboxTurn({
      ...other,
      environmentId: EnvironmentId.make("other"),
      input: {
        ...other.input,
        message: { ...other.input.message, messageId: MessageId.make("other-message") },
      },
    });
    await clearThreadOutboxEnvironment(EnvironmentId.make("environment"));
    expect([...harness.records.keys()]).toEqual(["other-message"]);
  });

  it("recovers separate pending threads in the same project without mixing their messages", async () => {
    const { enqueueThreadOutboxTurns, webThreadOutbox } = await import("./threadOutbox");
    const base = target();
    const creation = {
      projectId: ProjectId.make("project"),
      title: "Offline task",
      modelSelection: base.input.modelSelection,
      runtimeMode: base.input.runtimeMode,
      interactionMode: base.input.interactionMode,
      branch: "main",
      worktreePath: null,
      createdAt: "2026-10-06T00:00:00Z",
    };
    await enqueueThreadOutboxTurns(
      ["first", "second"].map((id) => ({
        ...base,
        input: {
          ...base.input,
          threadId: ThreadId.make(id),
          commandId: CommandId.make(id),
          message: { ...base.input.message, messageId: MessageId.make(id), text: id },
          bootstrap: { createThread: { ...creation, title: id } },
        },
      })),
    );
    await webThreadOutbox.drain();
    expect(harness.run).not.toHaveBeenCalled();
    vi.resetModules();
    const recovered = await import("./threadOutbox");
    await recovered.webThreadOutbox.load();
    expect(recovered.webThreadOutbox.isLoaded()).toBe(true);
    const first = recovered.readPendingThreadCreation({
      environmentId: base.environmentId,
      threadId: ThreadId.make("first"),
    });
    const second = recovered.readPendingThreadCreation({
      environmentId: base.environmentId,
      threadId: ThreadId.make("second"),
    });
    expect(first?.payload.input.message.text).toBe("first");
    expect(second?.payload.input.message.text).toBe("second");
    expect(first?.scope).not.toBe(second?.scope);
  });

  it("returns the replacement pending thread when retrying a rejected creation without a draft", async () => {
    const { enqueueThreadOutboxTurn, replaceThreadOutboxTurn, webThreadOutbox } =
      await import("./threadOutbox");
    const original = target();
    await enqueueThreadOutboxTurn({
      ...original,
      input: {
        ...original.input,
        bootstrap: {
          createThread: {
            projectId: ProjectId.make("project"),
            title: "Task",
            modelSelection: original.input.modelSelection,
            runtimeMode: original.input.runtimeMode,
            interactionMode: original.input.interactionMode,
            branch: null,
            worktreePath: null,
            createdAt: "2026-10-06T00:00:00Z",
          },
        },
      },
    });
    harness.online = true;
    harness.run.mockResolvedValueOnce(
      AsyncResult.fail({ _tag: "OrchestrationDispatchCommandError", message: "Rejected." }),
    );
    await webThreadOutbox.drain();
    const failed = webThreadOutbox.getSnapshot()[0]!;
    expect(failed.status).toBe("failed");
    harness.online = false;
    expect(await replaceThreadOutboxTurn(failed, failed.payload)).toEqual({
      environmentId: "environment",
      threadId: "replacement-thread",
    });
    expect(webThreadOutbox.getSnapshot()[0]).toMatchObject({
      scope: "environment:replacement-thread",
      status: "pending",
      attempted: false,
      payload: {
        input: { threadId: "replacement-thread", commandId: "generated-command" },
      },
    });
  });

  async function rejectPendingTaskWithFollowUp() {
    const { enqueueThreadOutboxTurns, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurns(pendingTaskWithFollowUp());
    harness.online = true;
    harness.run.mockResolvedValueOnce(
      AsyncResult.fail({ _tag: "OrchestrationDispatchCommandError", message: "Rejected." }),
    );
    await webThreadOutbox.drain();
    expect(harness.run).toHaveBeenCalledTimes(1);
    const failed = webThreadOutbox.getSnapshot()[0]!;
    expect(failed.status).toBe("failed");
    harness.online = false;
    return failed;
  }

  const movedToReplacementThread = [
    expect.objectContaining({ id: "message", scope: "environment:replacement-thread" }),
    expect.objectContaining({
      id: "follow-up",
      scope: "environment:replacement-thread",
      paused: false,
      payload: expect.objectContaining({
        input: expect.objectContaining({
          threadId: "replacement-thread",
          commandId: "follow-up-command",
        }),
      }),
    }),
  ];

  it("carries follow-ups queued behind a rejected creation to its replacement thread", async () => {
    const { replaceThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    const failed = await rejectPendingTaskWithFollowUp();

    await replaceThreadOutboxTurn(failed, failed.payload);

    expect(webThreadOutbox.getSnapshot()).toEqual(movedToReplacementThread);
  });

  it("follows a rejected creation another tab already moved", async () => {
    const { replaceThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    const failed = await rejectPendingTaskWithFollowUp();
    for (const [id, record] of harness.records) {
      harness.records.set(id, {
        ...record,
        scope: "environment:other-tab-thread",
        payload: {
          ...record.payload,
          input: { ...record.payload.input, threadId: ThreadId.make("other-tab-thread") },
        },
      });
    }

    await replaceThreadOutboxTurn(failed, failed.payload);

    expect(webThreadOutbox.getSnapshot()).toEqual(movedToReplacementThread);
  });

  it("cancels the follow-ups queued behind a cancelled pending task", async () => {
    const { cancelThreadOutboxTurn, enqueueThreadOutboxTurns, webThreadOutbox } =
      await import("./threadOutbox");
    await enqueueThreadOutboxTurns(pendingTaskWithFollowUp());

    await cancelThreadOutboxTurn(webThreadOutbox.getSnapshot()[0]!);

    expect(webThreadOutbox.getSnapshot()).toEqual([]);
  });

  it("keeps the follow-ups when a pending task is already being delivered", async () => {
    const { cancelThreadOutboxTurn, enqueueThreadOutboxTurns, webThreadOutbox } =
      await import("./threadOutbox");
    await enqueueThreadOutboxTurns(pendingTaskWithFollowUp());
    harness.records.set("message", { ...harness.records.get("message")!, attempted: true });

    await expect(cancelThreadOutboxTurn(webThreadOutbox.getSnapshot()[0]!)).rejects.toThrow(
      "Delivery has already started.",
    );

    expect(webThreadOutbox.getSnapshot().map((entry) => entry.id)).toEqual([
      "message",
      "follow-up",
    ]);
  });

  it.each(["arrived", "archived"])(
    "keeps an acknowledged creation until the server snapshot confirms it %s",
    async (state) => {
      const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
      const original = target();
      await enqueueThreadOutboxTurn({
        ...original,
        draftId: DraftId.make("draft"),
        input: {
          ...original.input,
          bootstrap: {
            createThread: {
              projectId: ProjectId.make("project"),
              title: "Task",
              modelSelection: original.input.modelSelection,
              runtimeMode: original.input.runtimeMode,
              interactionMode: original.input.interactionMode,
              branch: null,
              worktreePath: null,
              createdAt: "2026-10-06T00:00:00Z",
            },
          },
        },
      });
      harness.online = true;
      await webThreadOutbox.drain();
      expect(harness.marked).toHaveBeenCalled();
      expect(harness.finalized).not.toHaveBeenCalled();
      expect(webThreadOutbox.getSnapshot()[0]?.status).toBe("delivered");
      const recovered = (await import("./pendingThreadCreation")).pendingThreadCreation(
        webThreadOutbox.getSnapshot()[0]!,
      );
      expect(recovered?.message.shell).toMatchObject({
        id: "thread",
        title: "Task",
        projectId: "project",
      });
      await webThreadOutbox.drain();
      expect(harness.run).toHaveBeenCalledTimes(1);
      harness.existingThread = state === "arrived";
      harness.archivedThread = state === "archived";
      await webThreadOutbox.drain();
      expect(webThreadOutbox.getSnapshot()).toEqual([]);
      expect(harness.run).toHaveBeenCalledTimes(1);
    },
  );

  it("sends a voice message with its transcript where the recording was placed", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn(voiceTarget(`Fix ${VOICE_SLOT} today`));
    expect(harness.records.get("message")?.payload).toMatchObject({
      input: { message: { text: "Fix  today" } },
      voice: { clipId: "clip", insertAt: 4 },
    });
    harness.online = true;

    await webThreadOutbox.drain();

    expect(harness.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: "environment",
        sourceId: "codex:codex",
        clip: expect.objectContaining({ mimeType: "audio/webm", durationMs: 2_000 }),
      }),
    );
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect(harness.run.mock.calls[0]![2].input.message.text).toBe("Fix the login bug today");
    expect(harness.records.size).toBe(0);
  });

  it("titles a voice-only task from its transcript using the recorded source while offline", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    const creation = worktreeTarget();
    const { pendingWorktree: _, ...task } = creation;
    harness.availability.mockReturnValue({ kind: "hidden", reason: "unknown" });
    await enqueueThreadOutboxTurn({
      ...task,
      input: {
        ...task.input,
        message: { ...task.input.message, text: VOICE_SLOT },
        titleSeed: VOICE_SLOT,
        bootstrap: {
          createThread: { ...task.input.bootstrap.createThread, title: VOICE_SLOT },
        },
      },
      voice: { ...recording(), sourceId: "codex:recorded" },
    });
    expect(harness.records.get("message")?.payload.input).toMatchObject({
      titleSeed: "New thread",
      bootstrap: { createThread: { title: "New thread" } },
    });
    harness.online = true;

    await webThreadOutbox.drain();

    expect(harness.transcribe.mock.calls[0]![0].sourceId).toBe("codex:recorded");
    expect(harness.run.mock.calls[0]![2].input).toMatchObject({
      message: { text: "the login bug" },
      titleSeed: "the login bug",
      bootstrap: { createThread: { title: "the login bug" } },
    });
  });

  it.each([
    ["disabled", "Dictation is turned off for this environment."],
    ["forbidden", "This connection can't use dictation."],
    ["no-source", "No transcription model is available."],
  ])("keeps a voice message unsent when dictation is %s", async (reason, error) => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    harness.availability.mockReturnValue({ kind: "hidden", reason });
    await enqueueThreadOutboxTurn(voiceTarget(`Fix ${VOICE_SLOT}`));
    harness.online = true;

    await webThreadOutbox.drain();

    expect(harness.records.get("message")).toMatchObject({ status: "failed", error });
    expect(harness.transcribe).not.toHaveBeenCalled();
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("fails a recording with no speech instead of sending the typed text alone", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    const { DictationClipFailure } = await import("../dictation/transcribeClip");
    harness.transcribe.mockRejectedValue(
      new DictationClipFailure("empty", "No speech was detected."),
    );
    await enqueueThreadOutboxTurn(voiceTarget(`Fix ${VOICE_SLOT}`));
    harness.online = true;

    await webThreadOutbox.drain();

    expect(harness.records.get("message")).toMatchObject({
      status: "failed",
      attempted: false,
      error: "No speech was detected. Nothing was sent.",
    });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("retries a recording whose transcription was cut off by a disconnect", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    const { DictationClipFailure } = await import("../dictation/transcribeClip");
    harness.transcribe.mockRejectedValueOnce(
      new DictationClipFailure("transient", "Recording upload disconnected."),
    );
    await enqueueThreadOutboxTurn(voiceTarget(`Fix ${VOICE_SLOT}`));
    harness.online = true;

    await webThreadOutbox.drain();

    expect(harness.records.get("message")).toMatchObject({
      status: "pending",
      attempted: false,
      error: "Recording upload disconnected.",
    });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("moves a queued voice message back to its composer with its recording", async () => {
    const { enqueueThreadOutboxTurn, moveThreadOutboxTurnToComposer, webThreadOutbox } =
      await import("./threadOutbox");
    harness.draftPrompt = "Earlier idea";
    await enqueueThreadOutboxTurn(
      voiceTarget(`Check this ${VOICE_SLOT}`, { transcript: "the login bug" }),
    );

    await moveThreadOutboxTurnToComposer(webThreadOutbox.getSnapshot()[0]!);

    expect(harness.records.size).toBe(0);
    expect(harness.setPrompt).toHaveBeenCalledWith(
      { environmentId: "environment", threadId: "thread" },
      "Earlier idea\n\nCheck this",
    );
    expect(harness.park).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerKey: "environment:thread",
        environmentId: "environment",
        threadInstanceId: "codex",
        mimeType: "audio/webm",
        durationMs: 2_000,
        locale: "en-US",
        capturedDraft: null,
        status: "ready",
        transcript: "the login bug",
      }),
    );
  });
});
