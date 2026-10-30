import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { mobilePreferencesAtom } from "../../state/preferences";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentProjects } from "../../state/projects";
import {
  stickyNewTaskProjectAtom,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { newTaskDestination } from "./new-task-project-selection";

/** Compose opens a draft in the remembered project while it is listed, otherwise the first one. */
export function resolveStartNewTaskDestination(input: {
  readonly stickyProject: { readonly environmentId: string; readonly projectId: string } | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly requestId: string;
  readonly useLastProject?: boolean;
}) {
  const sticky = input.stickyProject;
  return newTaskDestination({
    projects: input.projects,
    requestId: input.requestId,
    useLastProject: input.useLastProject,
    currentProject: undefined,
    lastProject: sticky ?? undefined,
  });
}

/**
 * Waits for the remembered project to hydrate and reads state at press time, so
 * callers do not re-render on project changes.
 */
export async function readStartNewTaskDestination(requestId: string) {
  const [stickyProject, preferences] = await Promise.all([
    waitForComposerDraftsLoaded().then(
      () => appAtomRegistry.get(stickyNewTaskProjectAtom),
      () => null,
    ),
    Effect.runPromise(
      AtomRegistry.getResult(appAtomRegistry, mobilePreferencesAtom, {
        suspendOnWaiting: true,
      }).pipe(
        Effect.orElseSucceed(
          (): import("../../persistence/mobile-preferences").Preferences => ({}),
        ),
      ),
    ),
  ]);
  return resolveStartNewTaskDestination({
    stickyProject: preferences.lastThreadProject ?? stickyProject,
    useLastProject: preferences.useLastProjectForNewThreads,
    // The draft's own catalog: projects on enabled environments only.
    projects: appAtomRegistry.get(environmentProjects.projectsAtom),
    requestId,
  });
}
