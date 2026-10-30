import {
  buildTraitsTriggerLabel,
  getDescriptorStringValue,
  getTraitSelectChange,
  replaceDescriptorCurrentValue,
  selectableProviderOptionChoices,
  REASONING_SELECT_DESCRIPTOR_IDS,
  ULTRATHINK_PROMPT_PREFIX,
} from "@supaterm/client-runtime/model-traits";
import {
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@supaterm/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentLabel,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
  normalizeModelSlug,
} from "@supaterm/shared/model";
import {
  getSpeedToggle,
  getSpeedToggleNextValue,
  SPEED_TOGGLE_LABELS,
  type SpeedToggle,
  type SpeedToggleLevel,
} from "@supaterm/client-runtime/provider-speed-toggle";
import { memo } from "react";
import { BrainIcon, ZapIcon } from "@supaterm/icons";
import { UltrafastIcon } from "../Icons";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { useComposerDraftStore, DraftId } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { cn, isMacPlatform } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipShortcutLabel, TooltipTrigger } from "../ui/tooltip";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
  type ComposerControlSize,
} from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;

/**
 * All the picker reads from the prompt while rendering. Passing this instead of
 * the prompt keeps the picker from re-rendering on every keystroke.
 */
export type PromptUltrathink = "none" | "prefix" | "body";

export function readPromptUltrathink(prompt: string): PromptUltrathink {
  if (!isClaudeUltrathinkPrompt(prompt)) return "none";
  return isClaudeUltrathinkPrompt(prompt.replace(/^Ultrathink:\s*/i, "")) ? "body" : "prefix";
}

const SAVED_OPTION_LABELS: Readonly<Record<string, string>> = {
  agent: "Agent",
  effort: "Effort",
  reasoningEffort: "Reasoning effort",
  variant: "Reasoning",
};

function savedOptionLabel(id: string): string {
  return (
    SAVED_OPTION_LABELS[id] ??
    id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase())
  );
}

function buildUnavailableModelOptionDescriptors(
  selections: ProviderOptions | null | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  return (selections ?? []).map((selection) =>
    typeof selection.value === "boolean"
      ? {
          id: selection.id,
          label: savedOptionLabel(selection.id),
          type: "boolean" as const,
          currentValue: selection.value,
        }
      : {
          id: selection.id,
          label: savedOptionLabel(selection.id),
          type: "select" as const,
          options: [{ id: selection.value, label: selection.value }],
          currentValue: selection.value,
        },
  );
}

type TraitsPersistence =
  | {
      threadRef?: ScopedThreadRef;
      draftId?: DraftId;
      onModelOptionsChange?: never;
    }
  | {
      threadRef?: undefined;
      onModelOptionsChange: (nextOptions: ProviderOptions | undefined) => void;
    };

function DefaultBadge() {
  return (
    <Badge variant="outline" size="sm" className="min-w-0">
      Default
    </Badge>
  );
}

function getSelectedTraits(
  provider: ProviderDriverKind,
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  promptUltrathink: PromptUltrathink,
  modelOptions: ProviderOptions | null | undefined,
  allowPromptInjectedEffort: boolean,
) {
  const caps = getProviderModelCapabilities(models, model, provider);
  const modelIsUnavailable =
    provider === "opencode" &&
    !models.some((candidate) => candidate.slug === normalizeModelSlug(model, provider));
  const descriptors = modelIsUnavailable
    ? buildUnavailableModelOptionDescriptors(
        modelOptions?.filter((option) => option.id !== "agent" || option.value !== "plan"),
      )
    : getProviderOptionDescriptors({
        caps,
        selections: modelOptions,
      });
  const selectDescriptors = descriptors.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select",
  );
  const booleanDescriptors = descriptors.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "boolean" }> =>
      descriptor.type === "boolean",
  );
  const primarySelectDescriptor = selectDescriptors[0] ?? null;
  const contextWindowDescriptor =
    selectDescriptors.find((descriptor) => descriptor.id === "contextWindow") ?? null;
  const agentDescriptor = selectDescriptors.find((descriptor) => descriptor.id === "agent") ?? null;
  const thinkingDescriptor =
    booleanDescriptors.find((descriptor) => descriptor.id === "thinking") ?? null;

  const ultrathinkPromptControlled =
    allowPromptInjectedEffort &&
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    promptUltrathink !== "none";

  const ultrathinkInBodyText = ultrathinkPromptControlled && promptUltrathink === "body";
  const effort =
    (ultrathinkPromptControlled
      ? "ultrathink"
      : getDescriptorStringValue(primarySelectDescriptor)) ?? null;
  const thinkingEnabled =
    typeof thinkingDescriptor?.currentValue === "boolean" ? thinkingDescriptor.currentValue : null;
  const contextWindow = getDescriptorStringValue(contextWindowDescriptor);
  const selectedAgent = getDescriptorStringValue(agentDescriptor);
  const selectedAgentLabel = agentDescriptor
    ? getProviderOptionCurrentLabel(agentDescriptor)
    : null;

  return {
    caps,
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    contextWindowDescriptor,
    agentDescriptor,
    thinkingDescriptor,
    effort,
    thinkingEnabled,
    contextWindow,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    selectedAgent,
    selectedAgentLabel,
    modelIsUnavailable,
  };
}

function getTraitsSectionVisibility(input: {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  promptUltrathink?: PromptUltrathink | undefined;
  modelOptions: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
}) {
  const selected = getSelectedTraits(
    input.provider,
    input.models,
    input.model,
    input.promptUltrathink ?? "none",
    input.modelOptions,
    input.allowPromptInjectedEffort ?? true,
  );

  const speedToggle = selected.modelIsUnavailable
    ? null
    : getSpeedToggle(input.provider, selected.descriptors);
  const toggleOnlyDescriptorId = speedToggle?.coversDescriptor ? speedToggle.descriptorId : null;
  const hasMenuControls =
    selected.descriptors.some(
      (descriptor) =>
        descriptor.id !== toggleOnlyDescriptorId &&
        (descriptor.type === "select" || descriptor.id === "thinking"),
    ) ||
    (selected.modelIsUnavailable && selected.descriptors.length > 0);

  return {
    ...selected,
    speedToggle,
    toggleOnlyDescriptorId,
    hasMenuControls,
    hasAnyControls: hasMenuControls || speedToggle !== null,
  };
}

/**
 * `modelOptions` must already carry the composer's implicit defaults (see
 * `withImplicitFastModeDefault`) so the persisted selection matches what the
 * picker would write.
 */
export function getReasoningTraitStep(input: {
  provider: ProviderDriverKind;
  instanceId: ProviderInstanceId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ProviderOptions | undefined;
  reportedModelSelection: ModelSelection | null | undefined;
  prompt: string;
  direction: 1 | -1;
}) {
  const selected = getSelectedTraits(
    input.provider,
    input.models,
    input.model,
    readPromptUltrathink(input.prompt),
    input.modelOptions,
    true,
  );
  if (selected.modelIsUnavailable || selected.ultrathinkInBodyText) return null;
  const descriptor = selected.selectDescriptors.find((entry) =>
    REASONING_SELECT_DESCRIPTOR_IDS.has(entry.id),
  );
  if (!descriptor || descriptor.options.length < 2) return null;
  const isPrimary = descriptor.id === selected.primarySelectDescriptor?.id;
  const current =
    isPrimary && selected.ultrathinkPromptControlled
      ? "ultrathink"
      : getDescriptorStringValue(
          descriptor,
          { instanceId: input.instanceId, model: input.model, options: input.modelOptions ?? [] },
          input.reportedModelSelection,
        );
  const ordered = input.direction > 0 ? descriptor.options : descriptor.options.toReversed();
  // A reported value outside the catalog, such as OpenCode's "default", steps
  // from the catalog default, or from the end when there is none.
  const position =
    [current, getDescriptorStringValue(descriptor)]
      .map((value) => ordered.findIndex((option) => option.id === value))
      .find((index) => index >= 0) ?? -1;
  for (const option of [
    ...ordered.slice(position + 1),
    ...ordered.slice(0, Math.max(position, 0)),
  ]) {
    const change = getTraitSelectChange(selected, descriptor, input.prompt, option.id);
    if (!change) return null;
    if ("modelOptions" in change) {
      return change.modelOptions
        ? { prompt: change.prompt, modelOptions: change.modelOptions }
        : null;
    }
    // A slash command refuses the Ultrathink prefix, so skip that level.
    if (change.prompt.startsWith(ULTRATHINK_PROMPT_PREFIX)) return change;
  }
  return null;
}

/** What the Fast mode toggle would write, or null when the model has no speed option. */
export function getSpeedToggleChange(input: {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  modelOptions: ProviderOptions | null | undefined;
}): { modelOptions: ProviderOptions | undefined; level: SpeedToggleLevel } | null {
  const { descriptors, speedToggle } = getTraitsSectionVisibility({
    ...input,
    promptUltrathink: readPromptUltrathink(input.prompt),
  });
  if (speedToggle === null) return null;
  const nextValue = getSpeedToggleNextValue(speedToggle);
  return {
    modelOptions: buildProviderOptionSelectionsFromDescriptors(
      replaceDescriptorCurrentValue(descriptors, speedToggle.descriptorId, nextValue),
    ),
    level: speedToggleLevelForValue(speedToggle, nextValue),
  };
}

function speedToggleLevelForValue(
  speedToggle: SpeedToggle,
  value: string | boolean,
): SpeedToggleLevel {
  if (value === speedToggle.offValue) return "off";
  if (value === speedToggle.ultrafastValue) return "ultrafast";
  return "fast";
}

export function shouldRenderTraitsControls(input: {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  promptUltrathink?: PromptUltrathink | undefined;
  modelOptions: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
}): boolean {
  return getTraitsSectionVisibility(input).hasAnyControls;
}

export interface TraitsMenuContentProps {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  promptUltrathink?: PromptUltrathink | undefined;
  /** Receives an edit of the live prompt; the picker never holds the prompt text itself. */
  onPromptEdit?: (edit: (prompt: string) => string) => void;
  modelOptions?: ProviderOptions | null | undefined;
  reportedModelSelection?: ModelSelection | null | undefined;
  allowPromptInjectedEffort?: boolean;
  triggerClassName?: string;
  isComposerOwned?: boolean;
}

function useUpdateModelOptions(
  provider: ProviderDriverKind,
  instanceId: ProviderInstanceId | undefined,
  model: string | null | undefined,
  persistence: TraitsPersistence,
) {
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  return (nextOptions: ProviderOptions | undefined) => {
    if ("onModelOptionsChange" in persistence) {
      persistence.onModelOptionsChange(nextOptions);
      return;
    }
    const threadTarget = persistence.threadRef ?? persistence.draftId;
    if (!threadTarget) {
      return;
    }
    setProviderModelOptions(threadTarget, provider, nextOptions, {
      ...(instanceId ? { instanceId } : {}),
      model,
      persistSticky: true,
    });
  };
}

export const TraitsMenuContent = memo(function TraitsMenuContentImpl({
  provider,
  instanceId,
  models,
  model,
  promptUltrathink,
  onPromptEdit,
  modelOptions,
  reportedModelSelection,
  allowPromptInjectedEffort = true,
  omitToggleOnlyOptions = false,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence & { omitToggleOnlyOptions?: boolean }) {
  const modelSelection =
    instanceId && model ? { instanceId, model, options: modelOptions ?? [] } : null;
  const updateModelOptions = useUpdateModelOptions(provider, instanceId, model, persistence);
  const selected = getTraitsSectionVisibility({
    provider,
    models,
    model,
    promptUltrathink,
    modelOptions,
    allowPromptInjectedEffort,
  });
  const {
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    toggleOnlyDescriptorId,
    hasAnyControls,
    modelIsUnavailable,
  } = selected;
  const omittedDescriptorId = omitToggleOnlyOptions ? toggleOnlyDescriptorId : null;
  const menuSelectDescriptors = selectDescriptors.filter(
    (descriptor) => descriptor.id !== omittedDescriptorId,
  );
  const menuBooleanDescriptors = booleanDescriptors.filter(
    (descriptor) => descriptor.id !== omittedDescriptorId,
  );
  const updateDescriptors = (nextDescriptors: ReadonlyArray<ProviderOptionDescriptor>) => {
    updateModelOptions(buildProviderOptionSelectionsFromDescriptors(nextDescriptors));
  };

  const handleSelectChange = (
    descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
    value: string,
  ) => {
    // Whether a pick applies, and the options it writes, do not depend on the prompt text.
    const change = getTraitSelectChange(selected, descriptor, "", value);
    if (!change) return;
    onPromptEdit?.(
      (prompt) => getTraitSelectChange(selected, descriptor, prompt, value)?.prompt ?? prompt,
    );
    if ("modelOptions" in change) updateModelOptions(change.modelOptions);
  };

  if (!hasAnyControls) {
    return null;
  }

  if (modelIsUnavailable) {
    return (
      <>
        {descriptors.map((descriptor, index) => {
          const value = getProviderOptionCurrentLabel(
            descriptor,
            modelSelection,
            reportedModelSelection,
          );
          if (!value) return null;
          return (
            <div key={descriptor.id}>
              {index > 0 ? <MenuDivider /> : null}
              <MenuGroup>
                <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
                  {descriptor.label}
                </div>
                <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">{value}</div>
              </MenuGroup>
            </div>
          );
        })}
      </>
    );
  }

  return (
    <>
      {menuSelectDescriptors.map((descriptor, index) => {
        const selectedValue =
          ultrathinkPromptControlled && descriptor.id === primarySelectDescriptor?.id
            ? "ultrathink"
            : (getDescriptorStringValue(descriptor, modelSelection, reportedModelSelection) ?? "");

        return (
          <div key={descriptor.id}>
            {index > 0 ? <MenuDivider /> : null}
            <MenuGroup>
              <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
                {descriptor.label}
              </div>
              {ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id ? (
                <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
                  Your prompt contains &quot;ultrathink&quot; in the text. Remove it to change this
                  option.
                </div>
              ) : null}
              <MenuRadioGroup
                value={selectedValue}
                onValueChange={(value) => handleSelectChange(descriptor, value)}
              >
                {selectableProviderOptionChoices(descriptor).map((option) => (
                  <MenuRadioItem
                    key={option.id}
                    value={option.id}
                    hideIndicator
                    // Base UI keeps radio menus open by default. Close on pick so
                    // the traits menu behaves like the model picker.
                    closeOnClick
                    disabled={ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id}
                  >
                    <span className="flex w-full min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="min-w-0 truncate">{option.label}</span>
                        {option.isDefault ? <DefaultBadge /> : null}
                      </span>
                      {option.description ? (
                        <span className="max-w-56 text-pretty text-muted-foreground/80 text-xs">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </div>
        );
      })}
      {menuBooleanDescriptors.map((descriptor, index) => {
        const selectedValue = descriptor.currentValue === true ? "on" : "off";

        return (
          <div key={descriptor.id}>
            {index > 0 || menuSelectDescriptors.length > 0 ? <MenuDivider /> : null}
            <MenuGroup>
              <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                {descriptor.label}
              </div>
              <MenuRadioGroup
                value={selectedValue}
                onValueChange={(value) => {
                  updateDescriptors(
                    replaceDescriptorCurrentValue(descriptors, descriptor.id, value === "on"),
                  );
                }}
              >
                {(["on", "off"] as const).map((value) => (
                  <MenuRadioItem key={value} value={value} hideIndicator closeOnClick>
                    <span className="flex w-full min-w-0 items-center justify-between gap-3">
                      <span>{value === "on" ? "On" : "Off"}</span>
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </div>
        );
      })}
    </>
  );
});

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  instanceId,
  models,
  model,
  promptUltrathink,
  onPromptEdit,
  modelOptions,
  reportedModelSelection,
  allowPromptInjectedEffort = true,
  triggerClassName,
  isComposerOwned,
  shortcutLabel = null,
  size = "sm",
  hidden = false,
  disabled = false,
  ...persistence
}: TraitsMenuContentProps &
  TraitsPersistence & {
    size?: ComposerControlSize;
    hidden?: boolean;
    /** The key that opens the picker, shown on its trigger. */
    shortcutLabel?: string | null;
    disabled?: boolean;
  }) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const [isMenuOpen, setIsMenuOpen] = useComposerMenuState(hidden || disabled);
  const updateModelOptions = useUpdateModelOptions(provider, instanceId, model, persistence);
  const {
    descriptors,
    primarySelectDescriptor,
    speedToggle,
    ultrathinkPromptControlled,
    hasMenuControls,
    hasAnyControls,
  } = getTraitsSectionVisibility({
    provider,
    models,
    model,
    promptUltrathink,
    modelOptions,
    allowPromptInjectedEffort,
  });
  if (!hasAnyControls) {
    return null;
  }

  const speedOn = speedToggle !== null && speedToggle.level !== "off";
  const speedToggleControl = speedToggle ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            size={size}
            iconOnly
            activeBackground={false}
            aria-pressed={speedOn}
            aria-label="Fast mode"
            disabled={disabled}
            onClick={(event) =>
              updateModelOptions(
                buildProviderOptionSelectionsFromDescriptors(
                  replaceDescriptorCurrentValue(
                    descriptors,
                    speedToggle.descriptorId,
                    getSpeedToggleNextValue(speedToggle, event.altKey),
                  ),
                ),
              )
            }
          />
        }
      >
        <ComposerControlIcon
          icon={speedToggle.level === "ultrafast" ? UltrafastIcon : ZapIcon}
          size={size}
          className={speedOn ? "fill-current text-fast-mode" : undefined}
        />
      </TooltipTrigger>
      <TooltipPopup side="top">
        {speedToggle.ultrafastValue !== undefined ? (
          <div className="grid gap-1.5 py-0.5">
            <span className="font-medium">{SPEED_TOGGLE_LABELS[speedToggle.level]}</span>
            <TooltipShortcutLabel
              shortcut={isMacPlatform(navigator.platform) ? "⌥ Click" : "Alt+Click"}
            >
              Enable ultrafast
            </TooltipShortcutLabel>
          </div>
        ) : (
          SPEED_TOGGLE_LABELS[speedToggle.level]
        )}
      </TooltipPopup>
    </Tooltip>
  ) : null;

  if (!hasMenuControls) {
    return speedToggleControl;
  }

  const triggerLabel = buildTraitsTriggerLabel({
    descriptors,
    speedToggle,
    primarySelectDescriptorId: primarySelectDescriptor?.id ?? null,
    ultrathinkPromptControlled,
    modelSelection: instanceId && model ? { instanceId, model, options: modelOptions ?? [] } : null,
    reportedModelSelection,
  });

  const isCodexStyle = provider === "codex";

  return (
    <>
      <Menu
        open={isMenuOpen}
        onOpenChange={(open) => {
          setIsMenuOpen(open && !disabled);
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <ComposerControl
                    disabled={disabled}
                    aria-label={triggerLabel}
                    data-composer-shortcut={isComposerOwned ? "composer.effort" : undefined}
                    size={size}
                    className={cn(
                      isCodexStyle
                        ? "min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap sm:max-w-48"
                        : "shrink-0 whitespace-nowrap",
                      triggerClassName,
                    )}
                  />
                }
              />
            }
          >
            {isCodexStyle ? (
              <span
                className={cn(
                  "flex min-w-0 w-full items-center",
                  size === "xs" ? "gap-1" : "gap-1.5",
                )}
              >
                <span
                  data-composer-control-compact-icon
                  className="pointer-events-none invisible absolute"
                >
                  <ComposerControlIcon icon={BrainIcon} size={size} />
                </span>
                <span data-composer-control-label className="min-w-0 truncate">
                  {triggerLabel}
                </span>
                <ComposerControlChevron size={size} />
              </span>
            ) : (
              <>
                <span
                  data-composer-control-compact-icon
                  className="pointer-events-none invisible absolute"
                >
                  <ComposerControlIcon icon={BrainIcon} size={size} />
                </span>
                <span data-composer-control-label>{triggerLabel}</span>
                <ComposerControlChevron size={size} />
              </>
            )}
          </TooltipTrigger>
          <TooltipPopup side="top" shortcut={shortcutLabel}>
            {triggerLabel}
          </TooltipPopup>
        </Tooltip>
        <MenuPopup align="start" {...(isComposerOwned ? composerFloatingLayerProps : {})}>
          <TraitsMenuContent
            provider={provider}
            {...(instanceId ? { instanceId } : {})}
            models={models}
            model={model}
            promptUltrathink={promptUltrathink}
            {...(onPromptEdit ? { onPromptEdit } : {})}
            modelOptions={modelOptions}
            reportedModelSelection={reportedModelSelection}
            allowPromptInjectedEffort={allowPromptInjectedEffort}
            omitToggleOnlyOptions
            {...persistence}
          />
        </MenuPopup>
      </Menu>
      {speedToggleControl}
    </>
  );
});
