import {
  type ModelCapabilities,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@supaterm/contracts";
import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
  normalizeModelSlug,
  withImplicitFastModeDefault,
} from "@supaterm/shared/model";

import type { DraftId } from "../../composerDraftStore";
import { getProviderModelCapabilities, keepsUnavailableModelOptions } from "../../providerModels";
import {
  getReasoningTraitStep,
  getSpeedToggleChange,
  describeComposerModelTraits,
  TraitsMenuContent,
  type PromptUltrathink,
} from "./TraitsPicker";

type ComposerProviderStateInput = {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  promptInjectionState?: ComposerPromptInjectionState;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
};

type ComposerPromptInjectionState = "none" | "ultrathink";

type ComposerProviderState = {
  provider: ProviderDriverKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

type TraitsRenderInput = {
  provider: ProviderDriverKind;
  instanceId: ProviderInstanceId;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  onDraftModelOptionsChange?: () => void;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  reportedModelSelection?: ModelSelection | null | undefined;
  promptUltrathink: PromptUltrathink;
  onPromptEdit: (edit: (prompt: string) => string) => void;
};

export function getComposerPromptInjectionState(prompt: string): ComposerPromptInjectionState {
  return isClaudeUltrathinkPrompt(prompt) ? "ultrathink" : "none";
}

function resolveComposerOptionSelections(
  models: ReadonlyArray<ServerProviderModel>,
  model: string,
  provider: ProviderDriverKind,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): {
  caps: ModelCapabilities;
  selections: ReadonlyArray<ProviderOptionSelection> | undefined;
} {
  const caps = getProviderModelCapabilities(models, model, provider);
  return { caps, selections: withImplicitFastModeDefault(caps, modelOptions) };
}

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const { provider, model, models, modelOptions, promptInjectionState = "none" } = input;
  if (keepsUnavailableModelOptions(provider, model)) {
    const normalizedModel = normalizeModelSlug(model, provider);
    const modelIsInCatalog = models.some((candidate) => candidate.slug === normalizedModel);
    if (!modelIsInCatalog) {
      const preservedOptions = modelOptions?.filter(
        (option) => option.id !== "agent" || option.value !== "plan",
      );
      return {
        provider,
        promptEffort: null,
        modelOptionsForDispatch:
          preservedOptions && preservedOptions.length > 0 ? preservedOptions : undefined,
      };
    }
  }
  const { caps, selections } = resolveComposerOptionSelections(
    models,
    model,
    provider,
    modelOptions,
  );
  const descriptors = getProviderOptionDescriptors({ caps, selections });
  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<(typeof descriptors)[number], { type: "select" }> =>
      descriptor.type === "select",
  );
  const primaryValue = getProviderOptionCurrentValue(primarySelectDescriptor ?? null);
  const promptEffort = typeof primaryValue === "string" ? primaryValue : null;
  const ultrathinkActive =
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    promptInjectionState === "ultrathink";

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: buildExplicitProviderOptionSelectionsFromDescriptors(
      descriptors,
      selections,
    ),
    ...(ultrathinkActive
      ? {
          composerFrameClassName: "ultrathink-frame",
          composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.07)_inset]",
          modelPickerIconClassName: "ultrathink-chroma",
        }
      : {}),
  };
}

export function getComposerSpeedToggleChange(input: {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  prompt: string;
}) {
  const { selections } = resolveComposerOptionSelections(
    input.models,
    input.model,
    input.provider,
    input.modelOptions,
  );
  return getSpeedToggleChange({ ...input, modelOptions: selections });
}

/**
 * `cursor` is an expanded caret in `prompt`; the result's `cursor` keeps it on
 * the same character when stepping strips a typed Ultrathink prefix.
 */
export function getComposerReasoningStep(input: {
  provider: ProviderDriverKind;
  instanceId: ProviderInstanceId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  reportedModelSelection?: ModelSelection | null | undefined;
  prompt: string;
  cursor: number;
  direction: 1 | -1;
}): {
  prompt: string;
  cursor: number;
  modelOptions: ReadonlyArray<ProviderOptionSelection>;
} | null {
  const { prompt, cursor } = input;
  const { selections } = resolveComposerOptionSelections(
    input.models,
    input.model,
    input.provider,
    input.modelOptions,
  );
  const step = getReasoningTraitStep({
    provider: input.provider,
    instanceId: input.instanceId,
    model: input.model,
    models: input.models,
    modelOptions: selections,
    reportedModelSelection: input.reportedModelSelection,
    prompt,
    direction: input.direction,
  });
  if (!step) return null;
  return {
    prompt: step.prompt,
    cursor: Math.max(0, cursor + step.prompt.length - prompt.length),
    modelOptions: step.modelOptions,
  };
}

export function resolveComposerModelSettings(input: TraitsRenderInput) {
  const { selections } = resolveComposerOptionSelections(
    input.models,
    input.model,
    input.provider,
    input.modelOptions,
  );
  const props = { ...input, modelOptions: selections };
  const { hasOptions, summary, details } = describeComposerModelTraits(props);
  const canEdit = input.threadRef !== undefined || input.draftId !== undefined;
  return {
    summary,
    details,
    panel: hasOptions && canEdit ? <TraitsMenuContent {...props} inline /> : null,
  };
}
