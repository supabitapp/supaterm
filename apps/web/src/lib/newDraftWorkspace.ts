import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ScopedProjectRef,
  type ServerConfig,
  type SupatermProjectFile,
} from "@supaterm/contracts";
import { resolveNewThreadEnvMode, resolveProjectSettings } from "@supaterm/shared/projectSettings";
import { flushSync } from "react-dom";

import {
  composerDraftHasUserContent,
  type DraftId,
  type DraftSessionState,
  type DraftThreadEnvMode,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readProject, readThreadShells } from "~/state/entities";
import { readEnvironment } from "~/state/environments";
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
  const projectFileSource =
    project !== undefined && projectSettings.settings.defaultThreadEnvMode === null
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

// Environment queries wait for a connection, so reading the project file on an
// offline machine would never settle and the draft would never open.
function isConnected(environmentId: EnvironmentId) {
  return appAtomRegistry
    .get(environmentSummaries.connectedEnvironmentIdsAtom)
    .includes(environmentId);
}

/** The workspace a new thread in the project starts with. */
export async function resolveNewDraftWorkspace(
  projectRef: ScopedProjectRef,
  serverConfig: DraftServerConfig,
): Promise<NewDraftWorkspace> {
  const { projectFileSource, workspaceFor } = draftWorkspaceSource(projectRef, serverConfig);
  return workspaceFor(
    projectFileSource === null || !isConnected(projectFileSource.environmentId)
      ? null
      : await readSupatermProjectFile(
          projectFileSource.environmentId,
          projectFileSource.workspaceRoot,
        ),
  );
}

async function destinationWorkspace(
  projectRef: ScopedProjectRef,
  signal: AbortSignal,
): Promise<NewDraftWorkspace> {
  const readSource = () =>
    draftWorkspaceSource(projectRef, readEnvironment(projectRef.environmentId)?.serverConfig);
  const { projectFileSource, workspaceFor } = readSource();
  if (projectFileSource === null) return workspaceFor(null);
  const { environmentId, workspaceRoot } = projectFileSource;
  const cached = peekSupatermProjectFile(environmentId, workspaceRoot);
  if (cached !== undefined) return workspaceFor(cached);
  // A paired project can appear before its connection summary reports connected.
  const projectFile = await readSupatermProjectFile(environmentId, workspaceRoot, signal);
  return readSource().workspaceFor(projectFile);
}

/**
 * The workspace for a draft moving to another project or machine: the default a new thread
 * there starts with, unless the user chose one, which carries over.
 */
export async function retargetDraftWorkspace(
  draft: Pick<DraftSessionState, "workspaceExplicit" | "worktreePath">,
  projectRef: ScopedProjectRef,
  signal: AbortSignal,
): Promise<Partial<NewDraftWorkspace>> {
  return draft.workspaceExplicit || draft.worktreePath !== null
    ? {}
    : destinationWorkspace(projectRef, signal);
}

function isInProject(
  draft: DraftSessionState | null,
  projectRef: ScopedProjectRef,
): draft is DraftSessionState {
  return (
    draft !== null &&
    draft.promotedTo == null &&
    draft.environmentId === projectRef.environmentId &&
    draft.projectId === projectRef.projectId
  );
}

// Drafts showing a provisional workspace while their project's default loads. A send waits for
// the default unless the user has already chosen a workspace.
interface PendingWorkspaceDefault {
  readonly projectRef: ScopedProjectRef;
  readonly workspace: NewDraftWorkspace;
  // A reused draft keeps an earlier "manual" marker; only a switch to manual after opening is a choice.
  readonly openedManual: boolean;
  readonly settled: Promise<void>;
}

const pendingWorkspaceDefaults = new Map<DraftId, PendingWorkspaceDefault>();

function acceptsWorkspaceDefault(
  draft: DraftSessionState | null,
  pending: PendingWorkspaceDefault,
): draft is DraftSessionState {
  return (
    isInProject(draft, pending.projectRef) &&
    draft.envMode === pending.workspace.envMode &&
    !draft.workspaceExplicit &&
    draft.worktreePath === null &&
    (pending.openedManual || draft.environmentSelection !== "manual")
  );
}

/** A visible draft can use a provisional workspace while its project's default loads. */
export function trackPendingWorkspaceDefault(
  draftId: DraftId,
  projectRef: ScopedProjectRef,
  workspace: NewDraftWorkspace,
  resolution: Promise<NewDraftWorkspace>,
) {
  const { getDraftSession, setDraftThreadContext } = useComposerDraftStore.getState();
  const settled = resolution
    .then((resolved) => {
      const draft = getDraftSession(draftId);
      if (
        pendingWorkspaceDefaults.get(draftId) !== pending ||
        !acceptsWorkspaceDefault(draft, pending)
      )
        return;
      if (
        resolved.envMode === workspace.envMode &&
        resolved.startFromOrigin === workspace.startFromOrigin
      )
        return;
      // A send waiting on this promise must see the resolved workspace when it resumes.
      flushSync(() =>
        setDraftThreadContext(draftId, {
          envMode: resolved.envMode,
          ...(draft.startFromOrigin === workspace.startFromOrigin
            ? { startFromOrigin: resolved.startFromOrigin }
            : {}),
        }),
      );
    })
    .finally(() => {
      if (pendingWorkspaceDefaults.get(draftId) === pending)
        pendingWorkspaceDefaults.delete(draftId);
    });
  const pending: PendingWorkspaceDefault = {
    projectRef,
    workspace,
    openedManual: getDraftSession(draftId)?.environmentSelection === "manual",
    settled,
  };
  pendingWorkspaceDefaults.set(draftId, pending);
}

type CheckoutOutcome = boolean | "moved";

const pendingCheckouts = new Map<DraftId, Promise<CheckoutOutcome>>();

/**
 * A waiting send can resume only after the current checkout has been applied. Moving the draft
 * to another project drops the checkout, even if the draft moves back before it finishes.
 */
export function trackPendingDraftCheckout(
  draftId: DraftId,
  projectRef: ScopedProjectRef,
  checkoutReady: Promise<boolean>,
) {
  let resolve!: (outcome: CheckoutOutcome) => void;
  const settled = new Promise<CheckoutOutcome>((done) => {
    resolve = done;
  });
  const isCurrent = () => pendingCheckouts.get(draftId) === settled;
  const release = (outcome: CheckoutOutcome) => {
    unsubscribe();
    if (isCurrent()) pendingCheckouts.delete(draftId);
    resolve(outcome);
  };
  const unsubscribe = useComposerDraftStore.subscribe((state) => {
    if (!isInProject(state.getDraftSession(draftId), projectRef)) release("moved");
  });
  pendingCheckouts.set(draftId, settled);
  checkoutReady.then(release, () => release(false));
  return isCurrent;
}

/** "moved" means the send waited on a checkout the draft left by changing projects. */
export function readPendingWorkspaceDefault(
  draftId: DraftId,
): Promise<CheckoutOutcome | void> | null {
  const checkout = pendingCheckouts.get(draftId);
  if (checkout) return checkout;
  const pending = pendingWorkspaceDefaults.get(draftId);
  if (pending === undefined) return null;
  const draft = useComposerDraftStore.getState().getDraftSession(draftId);
  return acceptsWorkspaceDefault(draft, pending) ? pending.settled : null;
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
  if (projectFileSource === null || !isConnected(projectFileSource.environmentId)) {
    return { workspace: workspaceFor(null), applyProjectFile: () => {} };
  }
  const { environmentId, workspaceRoot } = projectFileSource;
  const projectFileRead = readSupatermProjectFile(environmentId, workspaceRoot);
  const cachedProjectFile = peekSupatermProjectFile(environmentId, workspaceRoot);
  if (cachedProjectFile !== undefined) {
    return { workspace: workspaceFor(cachedProjectFile), applyProjectFile: () => {} };
  }
  const workspace = workspaceFor(null);
  const applyProjectFile = (draftId: DraftId) =>
    trackPendingWorkspaceDefault(
      draftId,
      projectRef,
      workspace,
      projectFileRead.then(workspaceFor),
    );
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
}): boolean {
  const { draftId, project } = input;
  const store = useComposerDraftStore.getState();
  const draft = store.getDraftSession(draftId);
  if (!draft || draft.promotedTo) {
    return false;
  }
  const projectRef = scopeProjectRef(project.environmentId, project.id);
  store.setLogicalProjectDraftThreadId(input.logicalProjectKey, projectRef, draftId, {
    ...input.workspace,
    workspaceExplicit: false,
  });
  seedDraftModelSelection(draftId, projectRef);
  return true;
}

/**
 * Moves a draft the user wrote in to a project added for it. An empty draft stays: moving it
 * would replace the project's own draft and strand browser tabs on it.
 */
export async function moveWrittenDraftToProject(input: {
  readonly draftId: DraftId;
  readonly project: Project;
  readonly logicalProjectKey: string;
  readonly serverConfig: DraftServerConfig;
}): Promise<boolean> {
  const store = useComposerDraftStore.getState();
  if (!composerDraftHasUserContent(store.getComposerDraft(input.draftId))) return false;
  const before = store.getDraftSession(input.draftId);
  const workspace = await resolveNewDraftWorkspace(
    scopeProjectRef(input.project.environmentId, input.project.id),
    input.serverConfig,
  );
  // The user may have moved the draft while the project file loaded; that move stands.
  const after = useComposerDraftStore.getState().getDraftSession(input.draftId);
  if (after?.projectId !== before?.projectId || after?.environmentId !== before?.environmentId) {
    return false;
  }
  return moveDraftToProject({ ...input, workspace });
}
