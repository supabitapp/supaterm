import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import {
  DEFAULT_SERVER_SETTINGS,
  type ScopedProjectRef,
  type ServerConfig,
  type ServerSettings,
} from "@supaterm/contracts";
import { resolveNewThreadEnvMode, resolveProjectSettings } from "@supaterm/shared/projectSettings";

import { type DraftId, type DraftThreadEnvMode, useComposerDraftStore } from "~/composerDraftStore";
import { readProject, readThreadShells } from "~/state/entities";
import { readUnloadedThreadCount } from "~/state/olderSettledShelf";
import type { Project } from "~/types";
import {
  hasExplicitComposerModelSelection,
  resolveNewDraftStartFromOrigin,
} from "./chatThreadActions";
import { readSupatermProjectFile } from "./supatermProjectFileDefaults";

export interface NewDraftWorkspace {
  readonly envMode: DraftThreadEnvMode;
  readonly startFromOrigin: boolean;
}

/** The workspace a new thread in the project starts with. */
export async function resolveNewDraftWorkspace(
  projectRef: ScopedProjectRef,
  serverConfig: Pick<ServerConfig, "settings" | "newProjectsRoot"> | null | undefined,
): Promise<NewDraftWorkspace> {
  const project = readProject(projectRef) ?? undefined;
  const serverSettings = serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
  const projectSettings = resolveProjectSettings(serverSettings, project?.id ?? null, project);
  const projectFile =
    project !== undefined && projectSettings.settings.defaultThreadEnvMode === null
      ? await readSupatermProjectFile(project.environmentId, project.workspaceRoot)
      : null;
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
  readonly serverSettings: ServerSettings | null;
  readonly workspace: NewDraftWorkspace;
}): void {
  const { draftId, project } = input;
  const store = useComposerDraftStore.getState();
  const draft = store.getDraftSession(draftId);
  if (!draft || draft.promotedTo) {
    return;
  }
  const composerDraft = store.getComposerDraft(draftId);
  store.setLogicalProjectDraftThreadId(
    input.logicalProjectKey,
    scopeProjectRef(project.environmentId, project.id),
    draftId,
    input.workspace,
  );
  if (hasExplicitComposerModelSelection(composerDraft)) {
    return;
  }
  store.applyStickyState(draftId);
  const defaultModelSelection = input.serverSettings
    ? resolveProjectSettings(input.serverSettings, project.id, project).settings
        .defaultModelSelection
    : project.defaultModelSelection;
  if (defaultModelSelection) {
    store.setModelSelection(draftId, defaultModelSelection, { replaceOptions: true });
  }
}
