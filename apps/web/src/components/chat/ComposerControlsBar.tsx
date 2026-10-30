import type {
  EnvironmentId,
  ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeMode,
  ServerProvider,
} from "@supaterm/contracts";

import type { AppModelOption } from "../../modelSelection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "~/lib/utils";
import type { ChatComposerProps } from "./ChatComposer";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { ComposerControlSeparator } from "./ComposerControl";
import {
  ComposerFooterModeControls,
  ComposerModelPicker,
  type RuntimeModeOption,
} from "./ComposerFooterControls";
import {
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderState";
import type { PromptUltrathink } from "./TraitsPicker";
import type { useComposerProviderModel } from "./useComposerProviderModel";

/**
 * The composer footer controls: model picker, traits, mode controls and the overflow menu for
 * blocks that do not fit. Rendered in the expanded footer or the resting controls host.
 */
export function ComposerControlsBar(props: {
  environmentId: EnvironmentId;
  routeKind: ChatComposerProps["routeKind"];
  routeThreadRef: ChatComposerProps["routeThreadRef"];
  draftId: ChatComposerProps["draftId"];
  selectedProvider: ProviderDriverKind;
  selectedInstanceId: ProviderInstanceId;
  selectedModel: string;
  selectedProviderModels: ServerProvider["models"];
  composerModelOptions: ReturnType<typeof useComposerProviderModel>["composerModelOptions"];
  reportedModelSelection: ChatComposerProps["reportedModelSelection"];
  promptUltrathink: PromptUltrathink;
  onPromptEdit: (edit: (prompt: string) => string) => void;
  compatibleRuntimeMode: RuntimeMode;
  compatibleRuntimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  composerControlsCollapsed: boolean;
  composerControlsHidden: boolean;
  restingHiddenBlockCount: number;
  iconOnlyBlockCount: number;
  showInlineRestingControls: boolean;
  showLeadingSeparator: boolean;
  onOpenProviderSetup: ChatComposerProps["onOpenProviderSetup"];
  providerCatalogPending: boolean;
  isSendBusy: boolean;
  multipleModelsEnabled: boolean;
  multipleModelSelections: ChatComposerProps["multipleModelSelections"];
  onMultipleModelSelectionsChange: ChatComposerProps["onMultipleModelSelectionsChange"];
  selectedModelSelection: ModelSelection;
  onProviderModelSelect: ChatComposerProps["onProviderModelSelect"];
  activeThreadModelSelection: ChatComposerProps["activeThreadModelSelection"];
  selectedModelForPickerWithCustomFallback: string;
  lockedProvider: ChatComposerProps["lockedProvider"];
  lockedContinuationGroupKey: string | null;
  providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings: ChatComposerProps["keybindings"];
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  terminalOpen: boolean;
  modelPickerOpen: boolean;
  onModelPickerOpenChange: (open: boolean) => void;
  modelPickerIconClassName: string | undefined;
  getModelDisabledReason: ChatComposerProps["getModelDisabledReason"];
}) {
  const {
    environmentId,
    routeKind,
    routeThreadRef,
    draftId,
    selectedProvider,
    selectedInstanceId,
    selectedModel,
    selectedProviderModels,
    composerModelOptions,
    reportedModelSelection,
    promptUltrathink,
    onPromptEdit,
    compatibleRuntimeMode,
    compatibleRuntimeModeOptions,
    handleRuntimeModeChange,
    composerControlsCollapsed,
    composerControlsHidden,
    restingHiddenBlockCount,
    iconOnlyBlockCount,
    showInlineRestingControls,
    showLeadingSeparator,
    onOpenProviderSetup,
    providerCatalogPending,
    isSendBusy,
    multipleModelsEnabled,
    multipleModelSelections,
    onMultipleModelSelectionsChange,
    selectedModelSelection,
    onProviderModelSelect,
    activeThreadModelSelection,
    selectedModelForPickerWithCustomFallback,
    lockedProvider,
    lockedContinuationGroupKey,
    providerInstanceEntries,
    keybindings,
    modelOptionsByInstance,
    terminalOpen,
    modelPickerOpen,
    onModelPickerOpenChange,
    modelPickerIconClassName,
    getModelDisabledReason,
  } = props;
  const providerTraitsMenuContent = renderProviderTraitsMenuContent({
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    reportedModelSelection,
    promptUltrathink,
    onPromptEdit,
  });
  const providerTraitsPickerInput = {
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    reportedModelSelection,
    promptUltrathink,
    onPromptEdit,
    isComposerOwned: true,
    shortcutLabel: shortcutLabelForCommand(keybindings, "composer.effort"),
  } satisfies Parameters<typeof renderProviderTraitsPicker>[0];
  const providerTraitsPicker = renderProviderTraitsPicker(providerTraitsPickerInput);
  const restingProviderTraitsPicker = renderProviderTraitsPicker({
    ...providerTraitsPickerInput,
    size: composerControlsCollapsed ? "xs" : "sm",
    hidden: composerControlsHidden || restingHiddenBlockCount > 1,
  });
  const restingBlockDefs = [
    ...(providerTraitsPicker
      ? [
          {
            id: "traits",
            content: (
              <>
                <ComposerControlSeparator size={composerControlsCollapsed ? "xs" : "sm"} />
                {restingProviderTraitsPicker}
              </>
            ),
          },
        ]
      : []),
    {
      id: "mode",
      content: (
        <ComposerFooterModeControls
          keybindings={keybindings}
          runtimeMode={compatibleRuntimeMode}
          runtimeModeOptions={compatibleRuntimeModeOptions}
          size={composerControlsCollapsed ? "xs" : "sm"}
          hidden={composerControlsHidden || restingHiddenBlockCount > 0}
          onRuntimeModeChange={handleRuntimeModeChange}
        />
      ),
    },
  ];
  const hiddenRestingBlockIds = restingBlockDefs
    .slice(restingBlockDefs.length - restingHiddenBlockCount)
    .map((def) => def.id);
  // Its own element, so typing (which rebuilds the controls around it) leaves it cached.
  const composerModelPicker = (
    <ComposerModelPicker
      environmentId={environmentId}
      compact={false}
      isComposerOwned
      disabled={providerCatalogPending || isSendBusy}
      multipleModelsEnabled={multipleModelsEnabled}
      multipleModelSelections={multipleModelSelections}
      onMultipleModelSelectionsChange={onMultipleModelSelectionsChange}
      selectedModelSelection={selectedModelSelection}
      onProviderModelSelect={onProviderModelSelect}
      activeInstanceId={
        providerCatalogPending
          ? (activeThreadModelSelection?.instanceId ?? selectedInstanceId)
          : selectedInstanceId
      }
      model={
        providerCatalogPending
          ? (activeThreadModelSelection?.model ?? selectedModelForPickerWithCustomFallback)
          : selectedModelForPickerWithCustomFallback
      }
      lockedProvider={lockedProvider}
      lockedContinuationGroupKey={lockedContinuationGroupKey}
      instanceEntries={providerInstanceEntries}
      keybindings={keybindings}
      modelOptionsByInstance={modelOptionsByInstance}
      size={composerControlsCollapsed ? "xs" : "sm"}
      triggerClassName={
        composerControlsCollapsed
          ? cn(
              "min-w-13 shrink text-xs!",
              !showInlineRestingControls &&
                "@max-[640px]/composer-surface:[&_[data-chat-provider-model-picker-label]]:w-0 @max-[640px]/composer-surface:[&_[data-chat-provider-model-picker-label]]:flex-none",
            )
          : "-ms-2.5 min-w-13"
      }
      terminalOpen={terminalOpen}
      open={modelPickerOpen}
      instanceIndicatorBackground={
        composerControlsCollapsed
          ? "color-mix(in srgb, var(--chat-composer-glass-surface) var(--glass-opacity), transparent)"
          : "var(--contrast-input)"
      }
      {...(modelPickerIconClassName || composerControlsCollapsed
        ? {
            activeProviderIconClassName: cn(
              modelPickerIconClassName,
              composerControlsCollapsed &&
                "fill-muted-foreground/70! text-muted-foreground/70! [&_path]:fill-muted-foreground/70! [&_rect]:fill-muted-foreground/70! [&_[data-icon-detail]]:fill-transparent! [&[data-provider-package-icon]]:opacity-70 [&[data-provider-package-icon]_path:not([data-icon-detail])]:fill-muted-foreground!",
            ),
          }
        : {})}
      onOpenChange={onModelPickerOpenChange}
      getModelDisabledReason={getModelDisabledReason}
      onOpenProviderSetup={onOpenProviderSetup}
    />
  );
  return (
    <>
      {showLeadingSeparator ? (
        <ComposerControlSeparator
          size="xs"
          className="@max-[400px]/composer-surface:hidden"
          data-resting-controls-separator="true"
        />
      ) : null}
      {composerModelPicker}

      <>
        {restingBlockDefs.map((def, index) => {
          const hidden = index >= restingBlockDefs.length - restingHiddenBlockCount;
          return (
            <div
              key={def.id}
              data-resting-block={def.id}
              data-composer-block-icon-only={
                index >= restingBlockDefs.length - iconOnlyBlockCount ? "true" : "false"
              }
              aria-hidden={hidden || undefined}
              inert={hidden || undefined}
              className={cn(
                "flex w-max min-w-max shrink-0 items-center gap-1",
                hidden && "pointer-events-none invisible absolute",
                index >= restingBlockDefs.length - iconOnlyBlockCount &&
                  "[&_[data-composer-control-label]]:pointer-events-none [&_[data-composer-control-label]]:invisible [&_[data-composer-control-label]]:absolute [&_[data-composer-control-label]]:w-max [&_[data-composer-control-label]]:max-w-none [&_[data-composer-control-compact-icon]]:[visibility:inherit] [&_[data-composer-control-compact-icon]]:relative",
              )}
            >
              {def.content}
            </div>
          );
        })}
        <div
          data-resting-controls-overflow
          aria-hidden={hiddenRestingBlockIds.length === 0 || undefined}
          inert={hiddenRestingBlockIds.length === 0 || undefined}
          className={cn(
            "min-w-0 shrink-0",
            hiddenRestingBlockIds.length === 0 && "pointer-events-none invisible absolute",
          )}
        >
          <CompactComposerControlsMenu
            runtimeMode={compatibleRuntimeMode}
            runtimeModeOptions={compatibleRuntimeModeOptions}
            size={composerControlsCollapsed ? "xs" : "sm"}
            hidden={composerControlsHidden || hiddenRestingBlockIds.length === 0}
            keybindings={keybindings}
            traitsMenuContent={
              hiddenRestingBlockIds.includes("traits") ? providerTraitsMenuContent : undefined
            }
            onRuntimeModeChange={handleRuntimeModeChange}
          />
        </div>
      </>
    </>
  );
}
