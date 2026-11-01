import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { ScopedProjectRef } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { environmentProjects } from "../../state/projects";
import {
  stickyNewTaskProjectAtom,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { newTaskDestination } from "./new-task-project-selection";

/**
 * Compose opens a draft in the last project used on this device while it is listed;
 * otherwise, or with Use last project off, the draft asks for a project.
 */
export function resolveStartNewTaskDestination(input: {
  readonly stickyProject: ScopedProjectRef | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly requestId: string;
  readonly useLastProject: boolean | undefined;
}) {
  return newTaskDestination({
    projects: input.projects,
    requestId: input.requestId,
    useLastProject: input.useLastProject,
    currentProject: undefined,
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
  return resolveStartNewTaskDestination({
    stickyProject,
    useLastProject: AsyncResult.isSuccess(preferences)
      ? preferences.value.useLastProjectForNewThreads
      : undefined,
    // The draft's own catalog: projects on enabled environments only.
    projects: appAtomRegistry.get(environmentProjects.projectsAtom),
    requestId,
  });
}
