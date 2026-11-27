import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type SupatermProjectFile,
  ThreadId,
} from "@supaterm/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Project } from "../types";

const testState = vi.hoisted(() => ({
  projects: [] as Project[],
  projectFile: null as SupatermProjectFile | null,
  projectFileReads: 0,
  heldProjectFile: null as Promise<SupatermProjectFile | null> | null,
  connectedEnvironmentIds: ["environment-local"] as string[],
}));

vi.mock("../state/entities", () => ({
  readProject: (ref: { environmentId: string; projectId: string }) =>
    testState.projects.find(
      (project) => project.environmentId === ref.environmentId && project.id === ref.projectId,
    ) ?? null,
  readThreadShells: () => [],
}));
vi.mock("../state/presentation", () => ({
  environmentSummaries: { connectedEnvironmentIdsAtom: "connected-environment-ids" },
}));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => testState.connectedEnvironmentIds },
}));
vi.mock("../state/environments", () => ({
  readEnvironment: () => null,
  readEnvironmentProviders: () => undefined,
}));
vi.mock("../state/olderDoneShelf", () => ({ readUnloadedThreadCount: () => 0 }));
vi.mock("./supatermProjectFileDefaults", () => ({
  readSupatermProjectFile: async () => {
    testState.projectFileReads += 1;
    return testState.heldProjectFile ?? testState.projectFile;
  },
  peekSupatermProjectFile: () => undefined,
}));

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import {
  moveDraftToProject,
  moveWrittenDraftToProject,
  openNewDraftWorkspace,
  readPendingWorkspaceDefault,
  resolveNewDraftWorkspace,
} from "./newDraftWorkspace";

const environmentId = EnvironmentId.make("environment-local");
const draftId = DraftId.make("draft-move");

function makeProject(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: id,
    workspaceRoot: `/repos/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
    ...overrides,
  };
}

function serverConfigWith(settings: Partial<typeof DEFAULT_SERVER_SETTINGS>) {
  return { settings: { ...DEFAULT_SERVER_SETTINGS, ...settings } };
}

beforeEach(() => {
  testState.projects = [];
  testState.projectFile = null;
  testState.projectFileReads = 0;
  testState.heldProjectFile = null;
  testState.connectedEnvironmentIds = ["environment-local"];
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
});

describe("resolveNewDraftWorkspace", () => {
  it("does not wait on supaterm.json from a machine that is offline", async () => {
    const project = makeProject("offline-repo");
    testState.projects = [project];
    testState.projectFile = { defaultThreadEnvMode: "worktree" };
    testState.connectedEnvironmentIds = [];

    await expect(
      resolveNewDraftWorkspace(
        scopeProjectRef(environmentId, project.id),
        serverConfigWith({ defaultThreadEnvMode: null }),
      ),
    ).resolves.toMatchObject({ envMode: "local" });
    expect(testState.projectFileReads).toBe(0);
  });

  it("takes the mode from supaterm.json when settings leave it open", async () => {
    const project = makeProject("worktree-repo");
    testState.projects = [project];
    testState.projectFile = { defaultThreadEnvMode: "worktree" };

    await expect(
      resolveNewDraftWorkspace(
        scopeProjectRef(environmentId, project.id),
        serverConfigWith({ defaultThreadEnvMode: null, newWorktreesStartFromOrigin: true }),
      ),
    ).resolves.toEqual({ envMode: "worktree", startFromOrigin: true });
  });

  it("skips supaterm.json when the environment decides the mode", async () => {
    const project = makeProject("local-repo");
    testState.projects = [project];
    testState.projectFile = { defaultThreadEnvMode: "worktree" };

    await expect(
      resolveNewDraftWorkspace(
        scopeProjectRef(environmentId, project.id),
        serverConfigWith({ defaultThreadEnvMode: "local", newWorktreesStartFromOrigin: true }),
      ),
    ).resolves.toEqual({ envMode: "local", startFromOrigin: false });
    expect(testState.projectFileReads).toBe(0);
  });
});

describe("moveDraftToProject", () => {
  const from = makeProject("from-repo");
  const to = makeProject("to-repo");

  function openDraftInWorktreeOnPinnedBranch() {
    const store = useComposerDraftStore.getState();
    store.setLogicalProjectDraftThreadId(
      "from-repo",
      scopeProjectRef(environmentId, from.id),
      draftId,
      { threadId: ThreadId.make("thread-move"), envMode: "worktree", startFromOrigin: true },
    );
    store.setDraftThreadContext(draftId, { branch: "feature/pinned" });
    store.setPrompt(draftId, "keep this prompt");
  }

  it("gives the moved draft the new project's workspace and machine routing", () => {
    openDraftInWorktreeOnPinnedBranch();
    useComposerDraftStore.getState().setDraftThreadContext(draftId, { workspaceExplicit: true });

    moveDraftToProject({
      draftId,
      project: to,
      logicalProjectKey: "to-repo",
      workspace: { envMode: "local", startFromOrigin: false },
    });

    const store = useComposerDraftStore.getState();
    const draft = store.getDraftSession(draftId);
    expect(draft).toMatchObject({
      projectId: to.id,
      branch: null,
      worktreePath: null,
      envMode: "local",
      startFromOrigin: false,
    });
    expect(draft?.environmentSelection).toBeUndefined();
    expect(draft?.workspaceExplicit).toBeUndefined();
    expect(store.getComposerDraft(draftId)?.prompt).toBe("keep this prompt");
  });

  it("moves a draft the user wrote in to an added project and leaves an empty one", async () => {
    testState.projects = [from, to];
    openDraftInWorktreeOnPinnedBranch();
    const moveTo = (project: Project) =>
      moveWrittenDraftToProject({
        draftId,
        project,
        logicalProjectKey: project.id,
        serverConfig: serverConfigWith({ defaultThreadEnvMode: "local" }),
      });

    await expect(moveTo(to)).resolves.toBe(true);
    const store = useComposerDraftStore.getState();
    expect(store.getDraftSession(draftId)).toMatchObject({ projectId: to.id, envMode: "local" });
    expect(store.getComposerDraft(draftId)?.prompt).toBe("keep this prompt");

    store.setPrompt(draftId, "");
    await expect(moveTo(from)).resolves.toBe(false);
    expect(useComposerDraftStore.getState().getDraftSession(draftId)?.projectId).toBe(to.id);
  });

  it("leaves a draft the user moved elsewhere while the added project's file loaded", async () => {
    const other = makeProject("other-repo");
    testState.projects = [from, to, other];
    openDraftInWorktreeOnPinnedBranch();
    let finishRead: (file: SupatermProjectFile | null) => void = () => {};
    testState.heldProjectFile = new Promise((resolve) => {
      finishRead = resolve;
    });

    const moving = moveWrittenDraftToProject({
      draftId,
      project: to,
      logicalProjectKey: to.id,
      serverConfig: serverConfigWith({ defaultThreadEnvMode: null }),
    });
    moveDraftToProject({
      draftId,
      project: other,
      logicalProjectKey: other.id,
      workspace: { envMode: "local", startFromOrigin: false },
    });
    finishRead(null);

    await expect(moving).resolves.toBe(false);
    expect(useComposerDraftStore.getState().getDraftSession(draftId)?.projectId).toBe(other.id);
  });

  it("leaves a draft that is already being sent where it is", () => {
    openDraftInWorktreeOnPinnedBranch();
    useComposerDraftStore
      .getState()
      .markDraftThreadPromoting(draftId, { environmentId, threadId: ThreadId.make("thread-move") });

    moveDraftToProject({
      draftId,
      project: to,
      logicalProjectKey: "to-repo",
      workspace: { envMode: "local", startFromOrigin: false },
    });

    expect(useComposerDraftStore.getState().getDraftSession(draftId)).toMatchObject({
      projectId: from.id,
      envMode: "worktree",
    });
  });

  it("keeps the destination default when the previous project's supaterm.json arrives late", async () => {
    testState.projects = [from, to];
    let releaseProjectFile: (file: SupatermProjectFile | null) => void = () => {};
    testState.heldProjectFile = new Promise((resolve) => {
      releaseProjectFile = resolve;
    });
    const opened = openNewDraftWorkspace(
      scopeProjectRef(environmentId, from.id),
      serverConfigWith({ defaultThreadEnvMode: null }),
    );
    useComposerDraftStore
      .getState()
      .setLogicalProjectDraftThreadId(
        "from-repo",
        scopeProjectRef(environmentId, from.id),
        draftId,
        { threadId: ThreadId.make("thread-move"), ...opened.workspace },
      );
    opened.applyProjectFile(draftId);
    const fromProjectFileApplied = readPendingWorkspaceDefault(draftId);

    moveDraftToProject({
      draftId,
      project: to,
      logicalProjectKey: "to-repo",
      workspace: { envMode: "local", startFromOrigin: false },
    });
    const sendWaitsOn = readPendingWorkspaceDefault(draftId);
    releaseProjectFile({ defaultThreadEnvMode: "worktree" });
    await fromProjectFileApplied;

    expect(useComposerDraftStore.getState().getDraftSession(draftId)).toMatchObject({
      projectId: to.id,
      envMode: "local",
    });
    expect(sendWaitsOn).toBeNull();
  });
});
