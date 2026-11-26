import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import {
  DEFAULT_SERVER_SETTINGS,
  type ScopedProjectRef,
  type ServerConfig,
  type SupatermProjectFile,
} from "@supaterm/contracts";
import { resolveNewThreadEnvMode, resolveProjectSettings } from "@supaterm/shared/projectSettings";
import { flushSync } from "react-dom";

import {
  type DraftId,
  type DraftSessionState,
  type DraftThreadEnvMode,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readProject, readThreadShells } from "~/state/entities";
import { readUnloadedThreadCount } from "~/state/olderDoneShelf";
import { environmentSummaries } from "~/state/presentation";
import type { Project } from "~/types";
import { resolveNewDraftStartFromOrigin } from "./chatThreadActions";
import { seedDraftModelSelection } from "./seedDraftModelSelection";
import { peekSupatermProjectFile, readSupatermProjectFile } from "./supatermProjectFileDefaults";

export interface NewDraftWorkspace {
  readonly envMode: DraftThreadEnvMode;
  readonly startFromOrigin: boolean;
}

type DraftServerConfig = Pick<ServerConfig, "settings" | "newProjectsRoot"> | null | undefined;

function draftWorkspaceSource(projectRef: ScopedProjectRef, serverConfig: DraftServerConfig) {
  const project = readProject(projectRef) ?? undefined;
  const serverSettings = serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
  const projectSettings = resolveProjectSettings(serverSettings, project?.id ?? null, project);
  // Environment queries wait for a connection, so reading the project file on an
  // offline machine would never settle and the draft would never open.
  const projectFileSource =
    project !== undefined &&
    projectSettings.settings.defaultThreadEnvMode === null &&
    appAtomRegistry
      .get(environmentSummaries.connectedEnvironmentIdsAtom)
      .includes(project.environmentId)
      ? { environmentId: project.environmentId, workspaceRoot: project.workspaceRoot }
      : null;
  const workspaceFor = (projectFile: SupatermProjectFile | null): NewDraftWorkspace => {
    const envMode = resolveNewThreadEnvMode({
      projectSettings: resolveProjectSettings(
        serverSettings,
        project?.id ?? null,
        project,
        projectFile,
      ),
      workspaceRoot: project?.workspaceRoot ?? null,
      newProjectsRoot: serverConfig?.newProjectsRoot,
      projectHasThreads:
        readThreadShells().some(
          (thread) =>
            thread.environmentId === projectRef.environmentId &&
            thread.projectId === projectRef.projectId,
        ) ||
        readUnloadedThreadCount(
          [{ environmentId: projectRef.environmentId, id: projectRef.projectId }],
          [],
        ) > 0,
    });
    return {
      envMode,
      startFromOrigin: resolveNewDraftStartFromOrigin({
        envMode,
        newWorktreesStartFromOrigin: projectSettings.settings.newWorktreesStartFromOrigin,
      }),
    };
  };
  return { projectFileSource, workspaceFor };
}

/** The workspace a new thread in the project starts with. */
export async function resolveNewDraftWorkspace(
  projectRef: ScopedProjectRef,
  serverConfig: DraftServerConfig,
): Promise<NewDraftWorkspace> {
  const { projectFileSource, workspaceFor } = draftWorkspaceSource(projectRef, serverConfig);
  return workspaceFor(
    projectFileSource === null
      ? null
      : await readSupatermProjectFile(
          projectFileSource.environmentId,
          projectFileSource.workspaceRoot,
        ),
  );
}

// Drafts that opened before their project's supaterm.json was read. A send waits for the file's
// workspace default unless the user has already chosen a workspace.
interface ProvisionalWorkspace {
  readonly logicalProjectKey: string | undefined;
  readonly envMode: DraftThreadEnvMode;
  // A reused draft keeps an earlier "manual" marker; only a switch to manual after opening is a choice.
  readonly openedManual: boolean;
}

const pendingWorkspaceDefaults = new Map<
  DraftId,
  ProvisionalWorkspace & { readonly settled: Promise<void> }
>();

function keepsProvisionalWorkspace(
  draft: DraftSessionState | null,
  provisional: ProvisionalWorkspace,
): draft is DraftSessionState {
  return (
    draft !== null &&
    draft.promotedTo == null &&
    draft.logicalProjectKey === provisional.logicalProjectKey &&
    draft.envMode === provisional.envMode &&
    draft.worktreePath === null &&
    (provisional.openedManual || draft.environmentSelection !== "manual")
  );
}

export function readPendingWorkspaceDefault(draftId: DraftId): Promise<void> | null {
  const pending = pendingWorkspaceDefaults.get(draftId);
  if (pending === undefined) return null;
  const draft = useComposerDraftStore.getState().getDraftSession(draftId);
  return keepsProvisionalWorkspace(draft, pending) ? pending.settled : null;
}

/**
 * The workspace a new thread opens with right away. The draft opens without waiting on
 * supaterm.json: a cold read takes seconds on a loaded host. Its workspace default lands
 * afterwards through `applyProjectFile` unless the user picked a workspace or sent first.
 */
export function openNewDraftWorkspace(
  projectRef: ScopedProjectRef,
  serverConfig: DraftServerConfig,
): {
  readonly workspace: NewDraftWorkspace;
  readonly applyProjectFile: (draftId: DraftId) => void;
} {
  const { projectFileSource, workspaceFor } = draftWorkspaceSource(projectRef, serverConfig);
  if (projectFileSource === null) {
    return { workspace: workspaceFor(null), applyProjectFile: () => {} };
  }
  const { environmentId, workspaceRoot } = projectFileSource;
  const projectFileRead = readSupatermProjectFile(environmentId, workspaceRoot);
  const cachedProjectFile = peekSupatermProjectFile(environmentId, workspaceRoot);
  if (cachedProjectFile !== undefined) {
    return { workspace: workspaceFor(cachedProjectFile), applyProjectFile: () => {} };
  }
  const workspace = workspaceFor(null);
  const applyProjectFile = (draftId: DraftId) => {
    const openedDraft = useComposerDraftStore.getState().getDraftSession(draftId);
    const provisional: ProvisionalWorkspace = {
      logicalProjectKey: openedDraft?.logicalProjectKey,
      envMode: workspace.envMode,
      openedManual: openedDraft?.environmentSelection === "manual",
    };
    const settled = projectFileRead
      .then((projectFile) => {
        const fileWorkspace = workspaceFor(projectFile);
        const draft = useComposerDraftStore.getState().getDraftSession(draftId);
        if (
          fileWorkspace.envMode === workspace.envMode ||
          !keepsProvisionalWorkspace(draft, provisional)
        ) {
          return;
        }
        // Commit before a waiting send re-reads the composer's workspace.
        flushSync(() =>
          useComposerDraftStore.getState().setDraftThreadContext(draftId, {
            envMode: fileWorkspace.envMode,
            ...(draft.startFromOrigin === workspace.startFromOrigin
              ? { startFromOrigin: fileWorkspace.startFromOrigin }
              : {}),
          }),
        );
      })
      .finally(() => {
        if (pendingWorkspaceDefaults.get(draftId)?.settled === settled) {
          pendingWorkspaceDefaults.delete(draftId);
        }
      });
    pendingWorkspaceDefaults.set(draftId, { ...provisional, settled });
  };
  return { workspace, applyProjectFile };
}

/**
 * Moves an open draft to another project in place, keeping its prompt, with the
 * workspace and model a new thread there would start with. The project and its
 * workspace land together, so a send never pairs one project with another's
 * workspace mode.
 */
export function moveDraftToProject(input: {
  readonly draftId: DraftId;
  readonly project: Project;
  readonly logicalProjectKey: string;
  readonly workspace: NewDraftWorkspace;
}): void {
  const { draftId, project } = input;
  const store = useComposerDraftStore.getState();
  const draft = store.getDraftSession(draftId);
  if (!draft || draft.promotedTo) {
    return;
  }
  const projectRef = scopeProjectRef(project.environmentId, project.id);
  store.setLogicalProjectDraftThreadId(
    input.logicalProjectKey,
    projectRef,
    draftId,
    input.workspace,
  );
  seedDraftModelSelection(draftId, projectRef);
}
