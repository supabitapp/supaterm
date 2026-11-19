import type {
  ModelCapabilities,
  ModelSelection,
  ProviderInstanceId,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  ServerProviderModel,
} from "@supaterm/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionDescriptors,
  withImplicitFastModeDefault,
} from "@supaterm/shared/model";

export function resolveProviderOptionDescriptors(input: {
  readonly capabilities: ModelCapabilities | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}) {
  if (!input.capabilities) {
    return [];
  }
  return getProviderOptionDescriptors({
    caps: input.capabilities,
    selections: withImplicitFastModeDefault(input.capabilities, input.selections),
  });
}

export function getReasoningOptionDescriptor(descriptors: ReadonlyArray<ProviderOptionDescriptor>) {
  return (
    descriptors.find(
      (descriptor) =>
        descriptor.type === "select" &&
        ["reasoningEffort", "effort", "reasoning", "variant", "thinking"].includes(descriptor.id),
    ) ?? descriptors.find((descriptor) => descriptor.id === "thinking")
  );
}

/** Spells out the Fast off the picker shows, or a provider such as Cursor applies its own default. */
export function withImplicitFastModeSelection(
  selection: ModelSelection,
  providers: ReadonlyArray<{
    readonly instanceId: ProviderInstanceId;
    readonly models: ReadonlyArray<Pick<ServerProviderModel, "slug" | "capabilities">>;
  }>,
) {
  const capabilities = providers
    .find((provider) => provider.instanceId === selection.instanceId)
    ?.models.find((model) => model.slug === selection.model)?.capabilities;
  const options = capabilities
    ? withImplicitFastModeDefault(capabilities, selection.options)
    : selection.options;
  return options === selection.options ? selection : { ...selection, options };
}

export function applyProviderOptionSelection(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  change: ProviderOptionSelection,
) {
  const descriptor = descriptors.find((candidate) => candidate.id === change.id);
  if (!descriptor) {
    return null;
  }
  if (
    (descriptor.type === "boolean" && typeof change.value !== "boolean") ||
    (descriptor.type === "select" &&
      (typeof change.value !== "string" ||
        !descriptor.options.some((option) => option.id === change.value)))
  ) {
    return null;
  }

  const nextDescriptors = descriptors.map((candidate) =>
    candidate.id === descriptor.id
      ? {
          ...candidate,
          currentValue: change.value,
        }
      : candidate,
  ) as ReadonlyArray<ProviderOptionDescriptor>;

  return buildProviderOptionSelectionsFromDescriptors(nextDescriptors) ?? [];
}
