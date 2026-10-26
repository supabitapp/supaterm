import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { ScopedProjectRef } from "@supaterm/contracts";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentProjects } from "../../state/projects";
import {
  stickyNewTaskProjectAtom,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { newTaskDestination } from "./new-task-project-selection";

/** Compose opens a draft in the remembered project while it is listed, otherwise the first one. */
export function resolveStartNewTaskDestination(input: {
  readonly stickyProject: ScopedProjectRef | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly requestId: string;
}) {
  const sticky = input.stickyProject;
  return newTaskDestination(
    false,
    input.projects,
    sticky ? { environmentId: sticky.environmentId, id: sticky.projectId } : undefined,
    input.requestId,
  );
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
  return resolveStartNewTaskDestination({
    stickyProject,
    // The draft's own catalog: projects on enabled environments only.
    projects: appAtomRegistry.get(environmentProjects.projectsAtom),
    requestId,
  });
}
