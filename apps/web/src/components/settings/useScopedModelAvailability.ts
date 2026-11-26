import type { ProviderInstanceId, ServerProvider, UnifiedSettings } from "@supaterm/contracts";

import { mergeEnvironmentSettings } from "../../hooks/useSettings";
import {
  getCustomModelOptionsByInstance,
  getTextGenerationModelOptionsByInstance,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { useSettingsScope } from "./SettingsScopeContext";
import { useGT } from "gt-react";

export function useScopedModelDisabledReason(
  settings: UnifiedSettings,
  entries: readonly ProviderInstanceEntry[],
  options: {
    readonly supportsCapability?: (provider: ServerProvider) => boolean;
    readonly textGeneration?: boolean;
  } = {},
) {
  const gt = useGT();
  const { supportsCapability, textGeneration = false } = options;
  const { targets } = useSettingsScope();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  return (instanceId: ProviderInstanceId, model: string): string | null => {
    const sourceEntry = entries.find((entry) => entry.instanceId === instanceId);
    for (const candidate of targets) {
      const environment = environments.find(
        (entry) => entry.environmentId === candidate.environmentId,
      );
      const providers = providersByEnvironment.get(candidate.environmentId);
      if (!environment?.serverConfig || !providers) continue;
      const entry = applyProviderInstanceSettings(
        deriveProviderInstanceEntries(providers),
        candidate.settings,
        candidate.projectId,
      ).find((option) => option.instanceId === instanceId);
      const optionsForInstance = textGeneration
        ? getTextGenerationModelOptionsByInstance
        : getCustomModelOptionsByInstance;
      const options = optionsForInstance(
        mergeEnvironmentSettings(candidate.settings, settings),
        providers,
      ).get(instanceId);
      if (
        (supportsCapability &&
          !providers.some(
            (provider) => provider.instanceId === instanceId && supportsCapability(provider),
          )) ||
        !entry?.enabled ||
        !entry.isAvailable ||
        entry.driverKind !== sourceEntry?.driverKind ||
        !options?.some((option) => option.slug === model && !option.isUnavailable)
      ) {
        return gt(
          "This model is unavailable on {environment}. Select that environment to choose its model separately.",
          { environment: environment?.label ?? "a selected environment" },
        );
      }
    }
    return null;
  };
}
