import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import {
  AuthFilesystemReadScope,
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@supaterm/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useLayoutEffect } from "react";
import { Alert } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "../../state/atom-registry";
import type { QueuedThreadMessage } from "../../state/thread-outbox";
import type { ComposerDraft } from "../../state/use-composer-drafts";
import {
  editingQueuedMessageIdsAtom,
  holdDeletingQueuedMessage,
  holdEditingQueuedMessage,
  releaseDeletingQueuedMessage,
} from "../../state/use-thread-outbox";
import { buildPendingQueuedTasks } from "../../state/pending-new-tasks-model";
import { usePendingTaskListActions } from "../home/usePendingTaskListActions";
import { NewTaskFlowProvider, useNewTaskFlow } from "./new-task-flow-provider";

const transport = vi.hoisted(() => ({
  openScratch: vi.fn(),
  navigate: vi.fn(),
  goBack: vi.fn(),
  navigationState: vi.fn(),
  openScratchCommand: Symbol(),
  editorWrite: vi.fn(),
  removePendingTask: vi.fn(),
}));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
vi.mock("expo-haptics", () => ({
  impactAsync: async () => {},
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: transport.navigate,
    getState: transport.navigationState,
    goBack: transport.goBack,
    canGoBack: () => true,
  }),
}));
vi.mock("../home/home-thread-navigation", () => ({
  useHomeThreadRouteSelection: () => (params: object) => transport.navigate("Thread", params),
}));
vi.mock("../../state/shell", () => ({ environmentShell: {} }));
vi.mock("../../state/entities", () => ({
  useProjects: () => useAtomValue(projectsAtom),
  useThreadShells: () => [],
  useEnvironmentServerConfig: (id: EnvironmentId | null) => configs.get(id!) ?? null,
  useServerConfigs: () => configs,
}));
vi.mock("../../state/projects", () => ({
  projectEnvironment: { openScratch: transport.openScratchCommand, readFile: () => null },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => transport.openScratch,
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({
    isReady: true,
    presentation: { connection: { phase: "connected", error: null } },
  }),
}));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => sessionAtom },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => ({
    data: atom === sessionAtom ? { authenticated: true, scopes: [AuthFilesystemReadScope] } : null,
    error: null,
    isPending: false,
  }),
}));
vi.mock("../../state/vcs", () => ({ vcsEnvironment: { status: () => null } }));
vi.mock("../../state/queries", () => ({
  useBranches: () => ({ data: null }),
  useDebouncedValue: (value: string) => value,
  usePaginatedBranches: () => ({
    refs: [],
    data: null,
    isPending: false,
    isFetchingNextPage: false,
    refresh: () => {},
    loadNext: () => {},
  }),
}));
vi.mock("../../state/project-grouping", () => ({
  useMobileProjectGroupingSettings: () => ({ sidebarProjectGroupingMode: "separate" }),
}));

vi.mock("../../state/use-remote-environment-registry", () => ({
  useSavedRemoteConnections: () => ({
    savedConnectionsById: Object.fromEntries(
      environmentIds.map((id) => [id, { environmentLabel: id }]),
    ),
  }),
  useRemoteConnectionStatus: () => ({
    connectedEnvironments: environmentIds.map((id) => ({
      environmentId: id,
      environmentLabel: id,
      connectionState: "connected",
    })),
  }),
  setPendingConnectionError: () => {},
}));
vi.mock("../../state/use-model-option-memory", () => ({
  rememberModelOptions: () => {},
  withRememberedModelOptions: (selection: unknown) => selection,
}));
vi.mock("../../state/pending-task-editor-writes", () => ({
  capturePendingTaskEditorWriteBaseline: () => Promise.resolve(0),
  flushPendingTaskEditorWrite: transport.editorWrite,
}));
vi.mock("../../state/thread-outbox-removal", () => ({
  removeThreadOutboxMessage: transport.removePendingTask,
  removePendingThreadCreation: transport.removePendingTask,
}));
vi.mock("../../state/thread-outbox", async () => ({
  get threadOutboxManager() {
    return { queuedMessagesByThreadKeyAtom: queueAtom };
  },
  flattenQueuedThreadMessages: (messages: Record<string, ReadonlyArray<QueuedThreadMessage>>) =>
    Object.values(messages).flat(),
  hasQueuedFollowUps: (await import("../../state/thread-outbox-model")).hasQueuedFollowUps,
}));
vi.mock("../../state/use-thread-outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/use-thread-outbox")>()),
  useThreadOutboxMessages: () => useAtomValue(queueAtom),
}));
// The provider uses the real atom registry with an in-memory draft store; native
// persistence and attachment cleanup are outside environment-switch behavior.
vi.mock("../../state/use-composer-drafts", async (importOriginal) => ({
  get composerDraftsAtom() {
    return draftsAtom;
  },
  useComposerDraft: (key: string | null) => useAtomValue(draftsAtom)[key ?? ""] ?? emptyDraft,
  getComposerDraftSnapshot: (key: string) => readDraft(key),
  createNewTaskDraft: (project: { environmentId: EnvironmentId; projectId: ProjectId }) =>
    createDraft(project),
  retargetNewTaskDraft: (
    key: string,
    project: { environmentId: EnvironmentId; projectId: ProjectId },
  ) => updateDraft(key, { project: { ...project, createdAt: timestamp } }),
  isNewTaskDraftKey: (key: string) => key.startsWith("new-task:"),
  isComposerDraftEmpty: (await importOriginal<typeof import("../../state/use-composer-drafts")>())
    .isComposerDraftEmpty,
  setComposerDraftText: (key: string, text: string) => updateDraft(key, { text }),
  setComposerDraftContext: (key: string, context: ComposerDraft["context"]) =>
    updateDraft(key, { context }),
  replaceComposerDraftAttachments: (key: string, attachments: ComposerDraft["attachments"]) =>
    updateDraft(key, { attachments }),
  updateComposerDraftSettings: (key: string, settings: Partial<ComposerDraft>) =>
    updateDraft(key, settings),
  useStickyComposerModelSelection: () => null,
  setStickyComposerModelSelection: () => {},
  setStickyNewTaskProject: () => {},
  scheduleUnusedComposerAttachmentCleanup: () => {},
  clearComposerDraft: (key: string) => {
    const drafts = { ...appAtomRegistry.get(draftsAtom) };
    delete drafts[key];
    appAtomRegistry.set(draftsAtom, drafts);
  },
}));

const timestamp = "2026-10-04T00:00:00.000Z";
const environmentIds = ["first", "second", "third"].map((id) => EnvironmentId.make(id));
const [firstEnvironment, secondEnvironment, thirdEnvironment] = environmentIds;
const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: timestamp,
  models: [{ slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
};
const configs = new Map(
  environmentIds.map((id) => [
    id,
    {
      providers: [provider],
      settings: { ...DEFAULT_SERVER_SETTINGS, defaultThreadEnvMode: "local" },
      scratchWorkspaceRoot: `/scratch/${id}`,
    },
  ]),
);
function project(environmentId: EnvironmentId, scratch = true): EnvironmentProject {
  return {
    id: ProjectId.make(`${environmentId}-${scratch ? "scratch" : "repo"}`),
    environmentId,
    title: scratch ? "Scratch" : "Repository",
    workspaceRoot: scratch ? `/scratch/${environmentId}` : `/repo/${environmentId}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
const firstProject = project(firstEnvironment!);
const secondProject = project(secondEnvironment!);
const thirdProject = project(thirdEnvironment!);
const repositoryProject = project(firstEnvironment!, false);
const sessionAtom = Atom.make(AsyncResult.initial());
const projectsAtom = Atom.make<ReadonlyArray<EnvironmentProject>>([]).pipe(Atom.keepAlive);
const draftsAtom = Atom.make<Record<string, ComposerDraft>>({}).pipe(Atom.keepAlive);
const queueAtom = Atom.make<Record<string, ReadonlyArray<QueuedThreadMessage>>>({}).pipe(
  Atom.keepAlive,
);
const emptyDraft: ComposerDraft = { text: "", attachments: [] };
let nextDraft = 0;
function readDraft(key: string) {
  return appAtomRegistry.get(draftsAtom)[key] ?? emptyDraft;
}
function updateDraft(key: string, patch: Partial<ComposerDraft>) {
  appAtomRegistry.set(draftsAtom, {
    ...appAtomRegistry.get(draftsAtom),
    [key]: { ...readDraft(key), ...patch },
  });
}
function createDraft(projectRef: { environmentId: EnvironmentId; projectId: ProjectId }) {
  const key = `new-task:${++nextDraft}`;
  updateDraft(key, { project: { ...projectRef, createdAt: timestamp } });
  return key;
}
const metadata = {
  threadId: "new-thread",
  commandId: "send",
  messageId: "new-message",
  createdAt: timestamp,
};
const pendingTask: QueuedThreadMessage = {
  environmentId: firstEnvironment!,
  threadId: ThreadId.make("queued-thread"),
  messageId: MessageId.make("queued-message"),
  commandId: CommandId.make("queued-command"),
  text: "Queued task",
  attachments: [],
  modelSelection: { instanceId: provider.instanceId, model: "gpt-5.4" },
  createdAt: timestamp,
  creation: {
    projectId: repositoryProject.id,
    workspaceMode: "local",
    branch: null,
    worktreePath: null,
  },
};

let renderer: ReactTestRenderer | null = null;
let flow: ReturnType<typeof useNewTaskFlow>;
let pendingActions: ReturnType<typeof usePendingTaskListActions>;
function Probe() {
  const current = useNewTaskFlow();
  const actions = usePendingTaskListActions();
  useLayoutEffect(() => {
    flow = current;
    pendingActions = actions;
  }, [actions, current]);
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  transport.openScratch.mockReset();
  transport.navigate.mockReset();
  transport.goBack.mockReset();
  transport.navigationState.mockReset();
  transport.editorWrite.mockReset().mockResolvedValue(true);
  transport.removePendingTask.mockReset().mockImplementation(async () => {
    appAtomRegistry.set(queueAtom, {});
    appAtomRegistry.set(draftsAtom, {});
    return true;
  });
  vi.mocked(Alert.alert).mockClear();
  nextDraft = 0;
  appAtomRegistry.set(projectsAtom, [firstProject, secondProject, thirdProject, repositoryProject]);
  appAtomRegistry.set(draftsAtom, {});
  appAtomRegistry.set(queueAtom, {});
  appAtomRegistry.set(editingQueuedMessageIdsAtom, {});
  await act(() => {
    renderer = create(
      <RegistryContext.Provider value={appAtomRegistry}>
        <NewTaskFlowProvider>
          <Probe />
        </NewTaskFlowProvider>
      </RegistryContext.Provider>,
    );
  });
  await act(() => flow.setPrompt("Work in the selected environment"));
});
afterEach(async () => {
  await act(() => {
    if (renderer) {
      flow.finishEditingPendingTask();
      renderer.unmount();
    }
  });
  renderer = null;
  vi.unstubAllGlobals();
});

function beginSwitch(environmentId = secondEnvironment!) {
  const completion = Promise.withResolvers<AsyncResult.Success<EnvironmentProject>>();
  transport.openScratch.mockImplementationOnce(() => completion.promise);
  const switched = flow.switchEnvironment(environmentId);
  return {
    switched,
    complete: (destination = secondProject) => completion.resolve(AsyncResult.success(destination)),
  };
}

function deletePendingTask() {
  const task = buildPendingQueuedTasks([pendingTask])[0]!;
  pendingActions.confirmDeletePendingTask(task);
  const confirmation = vi.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  const deleteAction = confirmation?.find((action) => action.text === "Delete");
  if (!deleteAction?.onPress) throw new Error("Missing pending task deletion confirmation");
  deleteAction.onPress();
}

describe("pending task editor dismissal", () => {
  beforeEach(async () => {
    await act(() => {
      appAtomRegistry.set(queueAtom, { queued: [pendingTask] });
      expect(flow.beginEditingPendingTask(pendingTask.messageId)).toBe(true);
    });
  });

  it("opens a queued creation's reserved thread from the list", () => {
    const task = buildPendingQueuedTasks([pendingTask])[0]!;
    pendingActions.openPendingTask(task);
    expect(transport.navigate).toHaveBeenCalledWith("Thread", {
      environmentId: pendingTask.environmentId,
      threadId: pendingTask.threadId,
    });
  });

  it("leaves the local thread after cancelling its pending creation", async () => {
    await act(() => flow.cancelEditingPendingTask());
    transport.navigationState.mockReturnValue({
      routes: [
        {
          name: "Thread",
          params: { environmentId: pendingTask.environmentId, threadId: pendingTask.threadId },
        },
      ],
    });
    await act(async () => deletePendingTask());
    expect(transport.goBack).toHaveBeenCalledOnce();
  });

  it("deletes a closed editor's unsendable draft without delivering the old prompt", async () => {
    const draftKey = flow.draftKey!;
    await act(() => flow.setPrompt(""));
    await act(() => flow.cancelEditingPendingTask());

    expect(flow.editingPendingTask).toBeNull();
    expect(readDraft(draftKey).text).toBe("");
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)[pendingTask.messageId]).toBe("paused");
    expect(appAtomRegistry.get(queueAtom).queued).toEqual([pendingTask]);
    expect(transport.editorWrite).not.toHaveBeenCalled();

    await act(async () => deletePendingTask());
    expect(transport.removePendingTask).toHaveBeenCalledOnce();
    expect(appAtomRegistry.get(queueAtom)).toEqual({});
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)[pendingTask.messageId]).toBeUndefined();
    expect(vi.mocked(Alert.alert).mock.calls.map(([title]) => title)).toEqual([
      "Delete pending task?",
    ]);
  });

  it("keeps deletion blocked while the task is actually open", async () => {
    await act(async () => deletePendingTask());
    expect(transport.removePendingTask).not.toHaveBeenCalled();
    expect(vi.mocked(Alert.alert).mock.calls.at(-1)?.[0]).toBe("Pending task is open");
    expect(flow.prompt).toBe(pendingTask.text);
  });

  // The next draft resets the shared flow before this editor's cleanup runs.
  it("saves an edited pending task when the next draft resets the flow", async () => {
    await act(() => flow.setPrompt("Changed prompt"));
    await act(() => flow.reset());

    expect(flow.editingPendingTask).toBeNull();
    expect(transport.editorWrite).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ text: "Changed prompt" }) }),
    );
  });

  it("keeps a cleared pending task held when the next draft resets the flow", async () => {
    await act(() => flow.setPrompt(""));
    await act(() => flow.reset());

    expect(flow.editingPendingTask).toBeNull();
    expect(transport.editorWrite).not.toHaveBeenCalled();
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)[pendingTask.messageId]).toBe("paused");
  });

  it("reopens retained edits after a failed save", async () => {
    transport.editorWrite.mockResolvedValueOnce(false);
    await act(() => flow.setPrompt("Changed prompt"));
    await act(() => flow.cancelEditingPendingTask());
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)[pendingTask.messageId]).toBe("paused");

    await act(() => {
      expect(flow.beginEditingPendingTask(pendingTask.messageId)).toBe(true);
    });
    expect(flow.prompt).toBe("Changed prompt");
    expect(holdDeletingQueuedMessage(pendingTask.messageId)).toBe(false);
    await act(() => flow.cancelEditingPendingTask());
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)[pendingTask.messageId]).toBeUndefined();
  });

  it("does not let a dismissed editor's save release a deletion in progress", async () => {
    const save = Promise.withResolvers<boolean>();
    transport.editorWrite.mockReturnValueOnce(save.promise);
    await act(() => flow.cancelEditingPendingTask());
    expect(holdDeletingQueuedMessage(pendingTask.messageId)).toBe(true);
    expect(flow.beginEditingPendingTask(pendingTask.messageId)).toBe(false);
    await act(() => save.resolve(true));
    expect(holdEditingQueuedMessage(pendingTask.messageId)).toBe(false);

    releaseDeletingQueuedMessage(pendingTask.messageId, false);
    expect(holdEditingQueuedMessage(pendingTask.messageId)).toBe(true);
  });

  it("restores the stale-send hold when deleting retained edits fails", async () => {
    transport.removePendingTask.mockRejectedValueOnce(new Error("Outbox storage unavailable"));
    await act(() => flow.setPrompt(""));
    await act(() => flow.cancelEditingPendingTask());
    await act(async () => deletePendingTask());
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)[pendingTask.messageId]).toBe("paused");
    expect(appAtomRegistry.get(queueAtom).queued).toEqual([pendingTask]);
    expect(vi.mocked(Alert.alert).mock.calls.at(-1)?.[0]).toBe("Could not delete pending task");
    await act(() => {
      expect(flow.beginEditingPendingTask(pendingTask.messageId)).toBe(true);
    });
    expect(flow.prompt).toBe("");
  });
});

describe("new-task environment switching", () => {
  it("blocks an immediate submission before the pending switch rerenders", async () => {
    let pending!: ReturnType<typeof beginSwitch>;
    await act(() => {
      pending = beginSwitch();
      expect(flow.buildPendingTaskMessage(metadata)).toBeNull();
    });
    expect(flow.switchingToEnvironmentId).toBe(secondEnvironment);
    await act(async () => {
      pending.complete();
      expect(await pending.switched).toBe(true);
    });
    expect(flow.buildPendingTaskMessage(metadata)?.environmentId).toBe(secondEnvironment);
    expect(readDraft(flow.draftKey!).text).toBe("Work in the selected environment");
  });

  it.each(["reset", "project", "draft", "pending-task", "submission"] as const)(
    "does not retarget after %s replaces the pending switch",
    async (action) => {
      const originalDraft = flow.draftKey!;
      let pending!: ReturnType<typeof beginSwitch>;
      await act(() => {
        pending = beginSwitch();
      });
      await act(() => {
        switch (action) {
          case "reset":
            flow.reset();
            break;
          case "project":
            flow.setProject(repositoryProject);
            break;
          case "draft": {
            const other = createDraft({
              environmentId: firstEnvironment!,
              projectId: repositoryProject.id,
            });
            updateDraft(other, { text: "Other draft" });
            expect(flow.openDraft(other)).toBe(true);
            break;
          }
          case "pending-task":
            appAtomRegistry.set(queueAtom, { queued: [pendingTask] });
            expect(flow.beginEditingPendingTask(pendingTask.messageId)).toBe(true);
            break;
          case "submission":
            flow.setSubmitting(true);
            break;
        }
      });
      const selectedProject = flow.selectedProject;
      const selectedDraft = flow.draftKey;
      await act(async () => {
        pending.complete();
        expect(await pending.switched).toBe(false);
      });
      expect(flow.selectedProject).toBe(selectedProject);
      expect(flow.draftKey).toBe(selectedDraft);
      expect(readDraft(originalDraft).project?.environmentId).toBe(firstEnvironment);
      expect(flow.switchingToEnvironmentId).toBeNull();
    },
  );

  it("does not retarget an unmounted flow's saved draft", async () => {
    const originalDraft = flow.draftKey!;
    let pending!: ReturnType<typeof beginSwitch>;
    await act(() => {
      pending = beginSwitch();
    });
    await act(() => {
      renderer?.unmount();
      renderer = null;
    });
    pending.complete();
    expect(await pending.switched).toBe(false);
    expect(readDraft(originalDraft).project?.environmentId).toBe(firstEnvironment);
  });

  it("keeps the latest cycle when Scratch lookups finish out of order", async () => {
    let second!: ReturnType<typeof beginSwitch>;
    let third!: ReturnType<typeof beginSwitch>;
    await act(() => {
      second = beginSwitch();
    });
    await act(() => {
      third = beginSwitch(thirdEnvironment!);
    });
    expect(flow.switchingToEnvironmentId).toBe(thirdEnvironment);
    await act(async () => {
      third.complete(thirdProject);
      expect(await third.switched).toBe(true);
    });
    await act(async () => {
      second.complete();
      expect(await second.switched).toBe(false);
    });
    expect(flow.buildPendingTaskMessage(metadata)?.environmentId).toBe(thirdEnvironment);
    expect(readDraft(flow.draftKey!).project?.projectId).toBe(thirdProject.id);
  });

  it("keeps submission blocked when an older lookup finishes first", async () => {
    let second!: ReturnType<typeof beginSwitch>;
    let third!: ReturnType<typeof beginSwitch>;
    await act(() => {
      second = beginSwitch();
    });
    await act(() => {
      third = beginSwitch(thirdEnvironment!);
    });
    await act(async () => {
      second.complete();
      expect(await second.switched).toBe(false);
    });
    expect(flow.switchingToEnvironmentId).toBe(thirdEnvironment);
    expect(flow.buildPendingTaskMessage(metadata)).toBeNull();
    await act(async () => {
      third.complete(thirdProject);
      expect(await third.switched).toBe(true);
    });
    expect(flow.buildPendingTaskMessage(metadata)?.environmentId).toBe(thirdEnvironment);
  });

  it("rejects environment switching while submitting", async () => {
    await act(async () => {
      flow.setSubmitting(true);
      expect(await flow.switchEnvironment(secondEnvironment!)).toBe(false);
    });
    expect(flow.selectedProject).toBe(firstProject);
    expect(transport.openScratch).not.toHaveBeenCalled();
  });

  it("invalidates a switch when catalog changes replace the selected project", async () => {
    const originalDraft = flow.draftKey!;
    let pending!: ReturnType<typeof beginSwitch>;
    await act(() => {
      pending = beginSwitch();
    });
    await act(() =>
      appAtomRegistry.set(projectsAtom, [repositoryProject, secondProject, thirdProject]),
    );
    expect(flow.selectedProject).toBe(repositoryProject);
    await act(async () => {
      pending.complete();
      expect(await pending.switched).toBe(false);
    });
    expect(flow.selectedProject).toBe(repositoryProject);
    expect(readDraft(originalDraft).project?.environmentId).toBe(firstEnvironment);
  });
});
