import { canCreateProjectInEnvironment } from "@supaterm/client-runtime/operations/projects";
import type { EnvironmentConnectionPhase } from "@supaterm/client-runtime/connection";
import { type EnvironmentId, FilesystemBrowseError } from "@supaterm/contracts";
import * as Schema from "effect/Schema";

import { isNewTaskDraftKey } from "../../state/new-task-draft-key";
import { newTaskFlowKey } from "../threads/new-task-flow-state";
import { isDraftThreadRoute, type NewTaskDraftRouteParams } from "../threads/thread-route-state";

const isFilesystemBrowseError = Schema.is(FilesystemBrowseError);

/** Clone destinations may name folders that do not exist yet; cloning creates them. */
export function isMissingCloneParentBrowseFailure(input: {
  readonly cloning: boolean;
  readonly failure: unknown;
}): boolean {
  return (
    input.cloning &&
    isFilesystemBrowseError(input.failure) &&
    input.failure.failure === "read_directory_failed" &&
    input.failure.pathMissing === true
  );
}

export function resolveAddProjectEnvironment<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly connectionState: EnvironmentConnectionPhase;
  },
>(environmentOptions: ReadonlyArray<T>, requestedEnvironmentId: EnvironmentId | null): T | null {
  if (requestedEnvironmentId !== null) {
    return (
      environmentOptions.find(
        (environment) =>
          environment.environmentId === requestedEnvironmentId &&
          canCreateProjectInEnvironment(environment.connectionState),
      ) ?? null
    );
  }

  return (
    environmentOptions.find((environment) =>
      canCreateProjectInEnvironment(environment.connectionState),
    ) ?? null
  );
}

/**
 * The Add project path, kept per host. Each host shows its own default until a path is typed or
 * browsed for it, so switching hosts and back loses nothing. With no host selected (one dropping
 * out briefly), the field keeps the last path typed anywhere.
 */
export interface AddProjectPaths {
  readonly byHost: ReadonlyMap<EnvironmentId, string>;
  readonly last: string;
}

export function addProjectPathFor(
  paths: AddProjectPaths,
  environmentId: EnvironmentId | null,
  hostDefault: string,
): string {
  return environmentId === null ? paths.last : (paths.byHost.get(environmentId) ?? hostDefault);
}

export function withAddProjectPath(
  paths: AddProjectPaths,
  environmentId: EnvironmentId | null,
  path: string,
): AddProjectPaths {
  const byHost = new Map(paths.byHost);
  if (environmentId !== null) byHost.set(environmentId, path);
  return { byHost, last: path };
}

interface StackRoute {
  readonly key: string;
  readonly name: string;
  readonly params?: object;
}

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** The draft whose project chooser opened Add project, or null when Add project opened elsewhere. */
export function chooserDraftKey(
  routes: ReadonlyArray<StackRoute>,
  readFlowDraftKey: (flowKey: string) => string | null,
): string | null {
  const chooserIndex = routes.findLastIndex((route) => !route.name.startsWith("AddProject"));
  const chooser = routes[chooserIndex];
  if (chooser?.name !== "NewTaskProject") return null;
  const savedDraftId = firstParam((chooser.params as { draftId?: string | string[] })?.draftId);
  if (savedDraftId !== undefined) return savedDraftId;
  const draftRoute = routes[chooserIndex - 1];
  if (draftRoute === undefined || !isDraftThreadRoute(draftRoute)) return null;
  const flowKey = newTaskFlowKey(draftRoute);
  const flowDraftKey = flowKey === undefined ? null : readFlowDraftKey(flowKey);
  if (flowDraftKey !== null) return isNewTaskDraftKey(flowDraftKey) ? flowDraftKey : null;
  const draft = (draftRoute.params as { draft: NewTaskDraftRouteParams }).draft;
  return firstParam(draft.draftId) ?? null;
}
