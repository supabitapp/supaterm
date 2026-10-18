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
}));

vi.mock("../state/entities", () => ({
  readProject: (ref: { environmentId: string; projectId: string }) =>
    testState.projects.find(
      (project) => project.environmentId === ref.environmentId && project.id === ref.projectId,
    ) ?? null,
  readThreadShells: () => [],
}));
vi.mock("./supatermProjectFileDefaults", () => ({
  readSupatermProjectFile: async () => {
    testState.projectFileReads += 1;
    return testState.projectFile;
  },
}));

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { moveDraftToProject, resolveNewDraftWorkspace } from "./newDraftWorkspace";

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
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
});

describe("resolveNewDraftWorkspace", () => {
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

    moveDraftToProject({
      draftId,
      project: to,
      logicalProjectKey: "to-repo",
      serverSettings: null,
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
    expect(store.getComposerDraft(draftId)?.prompt).toBe("keep this prompt");
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
      serverSettings: null,
      workspace: { envMode: "local", startFromOrigin: false },
    });

    expect(useComposerDraftStore.getState().getDraftSession(draftId)).toMatchObject({
      projectId: from.id,
      envMode: "worktree",
    });
  });
});
