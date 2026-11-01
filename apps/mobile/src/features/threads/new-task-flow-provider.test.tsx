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
import {
  NewTaskFlowProvider,
  ServedNewTaskRouteProvider,
  useNewTaskFlow,
} from "./new-task-flow-provider";
import { draftFlowRoute, pruneNewTaskFlowStates } from "./new-task-flow-state";

const transport = vi.hoisted(() => ({
  openScratch: vi.fn(),
  navigate: vi.fn(),
  dispatch: vi.fn(),
  goBack: vi.fn(),
  navigationState: vi.fn(),
  openScratchCommand: Symbol(),
  editorWrite: vi.fn(),
  removePendingTask: vi.fn(),
  gitStatus: vi.fn((_query: { input: { cwd: string } }) => null),
}));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
vi.mock("expo-haptics", () => ({
  impactAsync: async () => {},
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("@react-navigation/native", () => ({
  CommonActions: { navigate: (name: string) => ({ type: "NAVIGATE", payload: { name } }) },
  useNavigation: () => ({
    navigate: transport.navigate,
    dispatch: transport.dispatch,
    getState: transport.navigationState,
    goBack: transport.goBack,
    canGoBack: () => true,
  }),
}));
vi.mock("../../state/shell", () => ({
  environmentShell: {},
  useEnvironmentShellReadiness: () => ({ status: "live", hasError: false, cacheRead: true }),
}));
vi.mock("../../state/workspace", () => ({
  useConnectionsReady: () => true,
  useWorkspaceEnvironments: () => [],
}));
vi.mock("../../state/project-has-threads", () => ({ useProjectHasThreads: () => false }));
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
vi.mock("../../state/vcs", () => ({ vcsEnvironment: { status: transport.gitStatus } }));
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
  get composerDraftsLoadedAtom() {
    return draftsLoadedAtom;
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
const draftsLoadedAtom = Atom.make(true).pipe(Atom.keepAlive);
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

type NewTaskFlow = ReturnType<typeof useNewTaskFlow>;
interface TestDraftRoute {
  readonly key: string;
  readonly draft: {
    readonly requestId: string;
    readonly draftId?: string;
    readonly pendingTaskId?: string;
  };
}

let renderer: ReactTestRenderer | null = null;
let stack: ReadonlyArray<TestDraftRoute> = [];
const routeFlows = new Map<string, NewTaskFlow>();
/** The topmost draft route's flow. */
let flow: NewTaskFlow;
let pendingActions: ReturnType<typeof usePendingTaskListActions>;
const selectThreadRoute = (params: ReactNavigation.RootParamList["Thread"]) =>
  transport.navigate("Thread", params);
function Probe(props: { readonly routeKey: string; readonly top: boolean }) {
  const current = useNewTaskFlow();
  const actions = usePendingTaskListActions(selectThreadRoute);
  useLayoutEffect(() => {
    routeFlows.set(props.routeKey, current);
    if (props.top) {
      flow = current;
      pendingActions = actions;
    }
  }, [actions, current, props.routeKey, props.top]);
  return null;
}
// Draft routes stay mounted under the ones pushed above them, as on the native stack.
function draftStack(routes: ReadonlyArray<TestDraftRoute>) {
  stack = routes;
  const top = routes.at(-1);
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <ServedNewTaskRouteProvider
        route={top && { key: top.key, params: { draft: top.draft } }}
        active
      >
        {routes.map((route) => (
          <NewTaskFlowProvider key={route.key} route={draftFlowRoute(route.key, route.draft)}>
            <Probe routeKey={route.key} top={route === top} />
          </NewTaskFlowProvider>
        ))}
      </ServedNewTaskRouteProvider>
    </RegistryContext.Provider>
  );
}
let routeCount = 0;
function draftRoute(draft?: { readonly draftId?: string; readonly pendingTaskId?: string }) {
  const key = `route-${++routeCount}`;
  return { key, draft: { requestId: key, ...draft } };
}
function pushDraftRoute(draft?: Parameters<typeof draftRoute>[0]) {
  renderer!.update(draftStack([...stack, draftRoute(draft)]));
}
function popDraftRoute() {
  renderer!.update(draftStack(stack.slice(0, -1)));
}
function coveredFlow(index = stack.length - 2): NewTaskFlow {
  return routeFlows.get(stack[index]!.key)!;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pruneNewTaskFlowStates({ routes: [] });
  transport.openScratch.mockReset();
  transport.navigate.mockReset();
  transport.dispatch.mockReset();
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
    renderer = create(draftStack([draftRoute()]));
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
    appAtomRegistry.set(queueAtom, { queued: [pendingTask] });
    await act(() => pushDraftRoute({ pendingTaskId: pendingTask.messageId }));
    expect(flow.editingPendingTask?.messageId).toBe(pendingTask.messageId);
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
    await act(() => pushDraftRoute());
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
    await act(() => pushDraftRoute());

    expect(coveredFlow().editingPendingTask).toBeNull();
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

  it("saves an edited pending task when another draft route covers it", async () => {
    await act(() => flow.setPrompt("Changed prompt"));
    await act(() => pushDraftRoute());

    expect(coveredFlow().editingPendingTask).toBeNull();
    expect(transport.editorWrite).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ text: "Changed prompt" }) }),
    );
  });

  it("keeps a cleared pending task held when another draft route covers it", async () => {
    await act(() => flow.setPrompt(""));
    await act(() => pushDraftRoute());

    expect(coveredFlow().editingPendingTask).toBeNull();
    expect(transport.editorWrite).not.toHaveBeenCalled();
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)[pendingTask.messageId]).toBe("paused");
  });

  it("reopens retained edits after a failed save", async () => {
    transport.editorWrite.mockResolvedValueOnce(false);
    await act(() => flow.setPrompt("Changed prompt"));
    await act(() => pushDraftRoute());
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)[pendingTask.messageId]).toBe("paused");

    await act(() => popDraftRoute());
    expect(flow.editingPendingTask?.messageId).toBe(pendingTask.messageId);
    expect(flow.prompt).toBe("Changed prompt");
    expect(holdDeletingQueuedMessage(pendingTask.messageId)).toBe(false);
    await act(() => pushDraftRoute());
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)[pendingTask.messageId]).toBeUndefined();
  });

  it("does not let a dismissed editor's save release a deletion in progress", async () => {
    const save = Promise.withResolvers<boolean>();
    transport.editorWrite.mockReturnValueOnce(save.promise);
    await act(() => pushDraftRoute());
    expect(holdDeletingQueuedMessage(pendingTask.messageId)).toBe(true);
    await act(() => popDraftRoute());
    expect(flow.editingPendingTask).toBeNull();
    expect(transport.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { name: "NewTaskProject" } }),
    );
    await act(() => save.resolve(true));
    expect(holdEditingQueuedMessage(pendingTask.messageId)).toBe(false);

    releaseDeletingQueuedMessage(pendingTask.messageId, false);
    expect(holdEditingQueuedMessage(pendingTask.messageId)).toBe(true);
  });

  it("restores the stale-send hold when deleting retained edits fails", async () => {
    transport.removePendingTask.mockRejectedValueOnce(new Error("Outbox storage unavailable"));
    await act(() => flow.setPrompt(""));
    await act(() => pushDraftRoute());
    await act(async () => deletePendingTask());
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)[pendingTask.messageId]).toBe("paused");
    expect(appAtomRegistry.get(queueAtom).queued).toEqual([pendingTask]);
    expect(vi.mocked(Alert.alert).mock.calls.at(-1)?.[0]).toBe("Could not delete pending task");
    await act(() => popDraftRoute());
    expect(flow.editingPendingTask?.messageId).toBe(pendingTask.messageId);
    expect(flow.prompt).toBe("");
  });
});

it("keeps a covered draft route on its own draft, project, and submission", async () => {
  await act(() => flow.setProject(repositoryProject));
  const coveredDraft = flow.draftKey;
  const statusRequests = () => transport.gitStatus.mock.calls.map(([query]) => query.input.cwd);
  transport.gitStatus.mockClear();
  await act(() => pushDraftRoute());
  await act(() => {
    flow.setProject(secondProject);
    flow.setSubmitting(true);
  });
  expect(statusRequests()).not.toContain(repositoryProject.workspaceRoot);
  expect(flow.draftKey).not.toBe(coveredDraft);
  expect(coveredFlow()).toMatchObject({
    served: false,
    draftKey: coveredDraft,
    selectedProject: repositoryProject,
    submitting: false,
    prompt: "Work in the selected environment",
  });

  await act(() => popDraftRoute());
  expect(flow).toMatchObject({
    served: true,
    draftKey: coveredDraft,
    selectedProject: repositoryProject,
  });
  expect(statusRequests()).toContain(repositoryProject.workspaceRoot);
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

  it.each(["next route", "project", "route draft", "pending-task", "submission"] as const)(
    "does not retarget after %s replaces the pending switch",
    async (action) => {
      const originalDraft = flow.draftKey!;
      let pending!: ReturnType<typeof beginSwitch>;
      await act(() => {
        pending = beginSwitch();
      });
      await act(() => {
        switch (action) {
          case "next route":
            pushDraftRoute();
            break;
          case "project":
            flow.setProject(repositoryProject);
            break;
          case "route draft": {
            const other = createDraft({
              environmentId: firstEnvironment!,
              projectId: repositoryProject.id,
            });
            updateDraft(other, { text: "Other draft" });
            pushDraftRoute({ draftId: other });
            break;
          }
          case "pending-task":
            appAtomRegistry.set(queueAtom, { queued: [pendingTask] });
            pushDraftRoute({ pendingTaskId: pendingTask.messageId });
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
