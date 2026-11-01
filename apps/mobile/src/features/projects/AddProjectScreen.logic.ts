import { canCreateProjectInEnvironment } from "@supaterm/client-runtime/operations/projects";
import type { EnvironmentConnectionPhase } from "@supaterm/client-runtime/connection";
import type { EnvironmentId } from "@supaterm/contracts";

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
