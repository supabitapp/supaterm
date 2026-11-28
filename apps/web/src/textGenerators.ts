import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ServerProvider,
  ServerSettings,
} from "@supaterm/contracts";

import { type ProviderInstanceEntry, providerInstanceEntriesFor } from "./providerInstances";

/** Text generation targets for a model picker. Supaterm has no custom text generators. */
export function textGenerationTargets(input: {
  readonly environmentId: EnvironmentId | null;
  readonly settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly projectId: ProjectId | null;
  readonly selections: ReadonlyArray<ModelSelection | null | undefined>;
}): {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
} {
  return {
    providers: input.providers,
    entries: providerInstanceEntriesFor(input.providers, input.settings, input.projectId),
  };
}
