import type {
  ModelSelection,
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
  RuntimeMode,
} from "@supaterm/contracts";
import type { UnifiedSettings } from "@supaterm/contracts/settings";
import { createModelSelection } from "@supaterm/shared/model";
import { type ComponentProps, memo } from "react";

import { shortcutLabelForCommand } from "../../keybindings";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ComposerControlIcon,
  ComposerControlSeparator,
  ComposerSelectControl,
} from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { resolveModelPickerSelectedModel } from "./ModelPickerContent";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { runtimeModeConfig } from "./runtimeModeConfig";
import { useComposerMenuState } from "./useComposerMenuState";

export type RuntimeModeOption = { mode: RuntimeMode } & (typeof runtimeModeConfig)[RuntimeMode];
const supervisedRuntimeModeOption = {
  mode: "approval-required" as const,
  ...runtimeModeConfig["approval-required"],
};
export const ComposerFooterModeControls = memo(function ComposerFooterModeControls(props: {
  keybindings: ResolvedKeybindingsConfig;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  size?: "sm" | "xs";
  hidden?: boolean;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const size = props.size ?? "sm";
  const composerFloatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const runtimeModeOption =
    props.runtimeModeOptions.find((option) => option.mode === props.runtimeMode) ??
    supervisedRuntimeModeOption;
  const RuntimeModeIcon = runtimeModeOption.icon;
  const runtimeModeShortcut = shortcutLabelForCommand(props.keybindings, "composer.mode");
  return (
    <>
      <ComposerControlSeparator size={size} />

      <Tooltip>
        <Select
          open={open}
          onOpenChange={setOpen}
          value={props.runtimeMode}
          onValueChange={(value) => props.onRuntimeModeChange(value!)}
        >
          <TooltipTrigger
            render={
              <ComposerSelectControl
                data-composer-shortcut="composer.mode"
                size={size}
                aria-label="Runtime mode"
              />
            }
          >
            <ComposerControlIcon icon={RuntimeModeIcon} size={size} />
            <SelectValue data-composer-control-label>{runtimeModeOption.label}</SelectValue>
          </TooltipTrigger>
          <SelectPopup alignItemWithTrigger={false} {...composerFloatingLayerProps}>
            {props.runtimeModeOptions.map((option) => {
              const OptionIcon = option.icon;
              return (
                <SelectItem
                  key={option.mode}
                  value={option.mode}
                  hideIndicator
                  className="min-w-64"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                        <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        {option.label}
                      </span>
                      <span className="text-muted-foreground text-xs leading-4">
                        {option.description}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </SelectPopup>
        </Select>
        <TooltipPopup side="top" shortcut={runtimeModeShortcut}>
          {runtimeModeOption.description}
        </TooltipPopup>
      </Tooltip>
    </>
  );
});

export const ComposerFooterPrimaryActions = memo(function ComposerFooterPrimaryActions(props: {
  compact: boolean;
  canOperateThread: boolean;
  canQueueMessage: boolean;
  isPreparingWorktree: boolean;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  canInterrupt: boolean;
  followUpBehavior: "queue" | "steer";
  keybindings: ResolvedKeybindingsConfig;
  canSteer: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  hasSendableContent: boolean;
  sendShortcut?: UnifiedSettings["sendShortcut"] | undefined;
  isDraftThread?: boolean | undefined;
  hasMultilinePrompt?: boolean | undefined;
  canResume: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  isEditingQueuedMessage: boolean;
  onSubmitMessage: React.MouseEventHandler<HTMLButtonElement>;
  onResume: () => void;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onCompactContext?: (() => void) | undefined;
  compactDisabled: boolean;
  compactDisabledReason: string | null;
}) {
  return (
    <>
      <ComposerPrimaryActions
        compact={props.compact}
        canOperateThread={props.canOperateThread}
        canQueueMessage={props.canQueueMessage}
        pendingAction={props.pendingAction}
        isRunning={props.isRunning}
        canInterrupt={props.canInterrupt}
        followUpBehavior={props.followUpBehavior}
        keybindings={props.keybindings}
        canSteer={props.canSteer}
        isSendBusy={props.isSendBusy}
        sendDisabledReason={props.sendDisabledReason}
        isConnecting={props.isConnecting}
        isEnvironmentUnavailable={props.isEnvironmentUnavailable}
        isPreparingWorktree={props.isPreparingWorktree}
        hasSendableContent={props.hasSendableContent}
        sendShortcut={props.sendShortcut}
        isDraftThread={props.isDraftThread}
        hasMultilinePrompt={props.hasMultilinePrompt}
        canResume={props.canResume}
        preserveComposerFocusOnPointerDown={props.preserveComposerFocusOnPointerDown ?? false}
        isEditingQueuedMessage={props.isEditingQueuedMessage}
        onSubmitMessage={props.onSubmitMessage}
        onResume={props.onResume}
        onPreviousPendingQuestion={props.onPreviousPendingQuestion}
        onInterrupt={props.onInterrupt}
      />
    </>
  );
});

/**
 * The composer's model picker. It owns the single- and multi-model selection
 * handlers so they are cached against the selection state, not rebuilt on
 * every ChatComposer render.
 */
export function ComposerModelPicker({
  multipleModelsEnabled,
  multipleModelSelections,
  onMultipleModelSelectionsChange,
  selectedModelSelection,
  onProviderModelSelect,
  ...pickerProps
}: Omit<
  ComponentProps<typeof ProviderModelPicker>,
  "selectedModels" | "onToggleModel" | "onInstanceModelChange"
> & {
  readonly multipleModelsEnabled: boolean;
  readonly multipleModelSelections: ReadonlyArray<ModelSelection> | null;
  readonly onMultipleModelSelectionsChange: (
    selections: ReadonlyArray<ModelSelection> | null,
  ) => void;
  readonly selectedModelSelection: ModelSelection;
  readonly onProviderModelSelect: (
    instanceId: ProviderInstanceId,
    model: string,
    options?: { focusComposer?: boolean },
  ) => void;
}) {
  const { instanceEntries, modelOptionsByInstance } = pickerProps;
  const toggleModel = (instanceId: ProviderInstanceId, model: string) => {
    const current = multipleModelSelections ?? [selectedModelSelection];
    const matchesModel = (selection: ModelSelection) => {
      if (selection.instanceId !== instanceId) return false;
      const entry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
      const resolvedModel = resolveModelPickerSelectedModel({
        driverKind: entry?.driverKind,
        model: selection.model,
        options: modelOptionsByInstance?.get(selection.instanceId) ?? [],
      });
      return (resolvedModel?.slug ?? selection.model) === model;
    };
    const exists = current.some(matchesModel);
    const next = exists
      ? current.filter((selection) => !matchesModel(selection))
      : [...current, createModelSelection(instanceId, model)];
    if (next.length > 1) {
      onMultipleModelSelectionsChange(next);
    } else {
      onMultipleModelSelectionsChange(null);
      const remaining = next[0] ?? selectedModelSelection;
      onProviderModelSelect(remaining.instanceId, remaining.model, {
        focusComposer: false,
      });
    }
  };
  return (
    <ProviderModelPicker
      {...pickerProps}
      {...(multipleModelsEnabled
        ? {
            ...(multipleModelSelections !== null
              ? { selectedModels: multipleModelSelections }
              : {}),
            onToggleModel: toggleModel,
          }
        : {})}
      onInstanceModelChange={(instanceId, model) => {
        onMultipleModelSelectionsChange(null);
        onProviderModelSelect(instanceId, model);
      }}
    />
  );
}
