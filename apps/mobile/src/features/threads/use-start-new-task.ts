import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { ScopedProjectRef } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import {
  DEFAULT_MOBILE_PROJECT_GROUPING_SETTINGS,
  resolveMobileProjectGroupingSettings,
} from "../../state/project-grouping.logic";
import { environmentProjects } from "../../state/projects";
import {
  stickyNewTaskProjectAtom,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { savedConnectionsByIdAtom } from "../../state/use-remote-environment-registry";
import { workspaceConnections } from "../../state/workspace";
import { buildHomeProjectScopes, resolveHomeProjectFilterScope } from "../home/homeThreadList";
import { newTaskDestination, newTaskFilteredProject } from "./new-task-project-selection";

/**
 * Compose opens a draft in the project the thread list is filtered to, else in the
 * last project used on this device while it is listed; otherwise, or with Use last
 * project off, the draft asks for a project.
 */
export function resolveStartNewTaskDestination(input: {
  readonly stickyProject: ScopedProjectRef | null;
  readonly filteredProject:
    | { readonly environmentId: string; readonly projectId: string }
    | undefined;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly requestId: string;
  readonly useLastProject: boolean | undefined;
}) {
  return newTaskDestination({
    projects: input.projects,
    requestId: input.requestId,
    useLastProject: input.useLastProject,
    currentProject: undefined,
    filteredProject: input.filteredProject,
    lastProject: input.stickyProject ?? undefined,
  });
}

/**
 * Waits for the remembered project to hydrate and reads state at press time, so
 * callers do not re-render on project changes.
 */
export async function readStartNewTaskDestination(requestId: string) {
  const stickyProject = await waitForComposerDraftsLoaded().then(
    () => appAtomRegistry.get(stickyNewTaskProjectAtom),
    () => null,
  );
  const preferences = appAtomRegistry.get(mobilePreferencesAtom);
  const saved = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
  // The draft's own catalog: projects on enabled environments only.
  const projects = appAtomRegistry.get(environmentProjects.projectsAtom);
  const projectGroupingMode = (
    saved ? resolveMobileProjectGroupingSettings(saved) : DEFAULT_MOBILE_PROJECT_GROUPING_SETTINGS
  ).sidebarProjectGroupingMode;
  // Resolve the thread list's filter as useHomeListOptions does: a removed connection's filter reads as all.
  const listFilters = saved?.threadListFilters;
  const listEnvironmentId =
    listFilters?.environmentId != null &&
    appAtomRegistry.get(savedConnectionsByIdAtom)[listFilters.environmentId] !== undefined
      ? listFilters.environmentId
      : null;
  const filteredScope = resolveHomeProjectFilterScope(
    buildHomeProjectScopes({ projects, environmentId: listEnvironmentId, projectGroupingMode }),
    projects,
    { selectedProjectKey: listFilters?.projectKey ?? null, projectGroupingMode },
  );
  const connectedEnvironmentIds = new Set(
    appAtomRegistry
      .get(workspaceConnections.environmentsAtom)
      .filter((environment) => environment.connectionState === "connected")
      .map((environment) => environment.environmentId),
  );
  return resolveStartNewTaskDestination({
    stickyProject,
    filteredProject: filteredScope
      ? newTaskFilteredProject(
          filteredScope,
          listEnvironmentId,
          connectedEnvironmentIds,
          stickyProject ?? undefined,
        )
      : undefined,
    useLastProject: saved?.useLastProjectForNewThreads,
    projects,
    requestId,
  });
}
