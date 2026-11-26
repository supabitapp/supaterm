import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type WorktreeSubmodules,
} from "@supaterm/contracts";
import { createModelSelection, pickModelSelection } from "@supaterm/shared/model";
import { resolveProjectSettings } from "@supaterm/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";

import { useClientSettings } from "../../hooks/useSettings";
import {
  defaultModelSelectionsAreMixed,
  getCustomModelOptionsByInstance,
} from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { resolveEnvModeLabel, WORKTREE_SUBMODULES_LABELS } from "../BranchToolbar.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { PULL_REQUEST_MERGE_METHOD_LABELS } from "../pullRequest/pullRequestDetail.logic";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { resolveDefaultModelSettingsPresentation } from "./ProjectDefaultsSettings.logic";
import type { ProjectSettingsCategory } from "./ProjectSettingsPanel";
import { useSearchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useScopedSettingSource,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { T, useGT, useMessages } from "gt-react";

const WORKTREE_SUBMODULES_OPTIONS = ["recursive", "top-level", "none"] as const;
function isWorktreeSubmodules(value: string | null): value is WorktreeSubmodules {
  return value !== null && (WORKTREE_SUBMODULES_OPTIONS as readonly string[]).includes(value);
}

export function ProjectDefaultsSettings({ category }: { category: ProjectSettingsCategory }) {
  const searchableSetting = useSearchableSetting();
  const messages = useMessages();
  const gt = useGT();
  const { scope, target, targets, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const clientSettings = useClientSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const representative = target
    ? environments.find((environment) => environment.environmentId === target.environmentId)
    : undefined;
  const providers =
    (representative?.serverConfig
      ? providersByEnvironment.get(representative.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, target?.projectId ?? null);
  const presentation = resolveDefaultModelSettingsPresentation({
    entries,
    providers,
    settings,
    projectId: target?.projectId ?? null,
  });
  const selection = presentation.selection;
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );
  const activeEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const mixedModel = defaultModelSelectionsAreMixed(
    clientSettings,
    targets.map((candidate) => ({
      projectId: candidate.projectId,
      settings: candidate.settings,
      providers: providersByEnvironment.get(candidate.environmentId) ?? EMPTY_SERVER_PROVIDERS,
    })),
  );
  const automaticModel =
    targets.length > 0 &&
    targets.every((candidate) => candidate.settings.defaultModelSelection === null);
  const mixedFallback = useScopedSettingsMixed(["fallbackModelSelection"]);
  const fallbackSelection = settings.fallbackModelSelection ?? selection;
  const fallbackEntry = entries.find((entry) => entry.instanceId === fallbackSelection?.instanceId);
  const fallbackModelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    fallbackSelection?.instanceId,
    fallbackSelection?.model,
  );
  const mixedPermissions = useScopedSettingsMixed(["defaultRuntimeMode"]);
  const PermissionIcon = runtimeModeConfig[settings.defaultRuntimeMode].icon;
  const mixedWorkspace = useScopedSettingsMixed(["defaultThreadEnvMode"]);
  const mixedAutoPull = useScopedSettingsMixed(["defaultAutoPull"]);
  const mixedAgentCredits = useScopedSettingsMixed(["removeAgentCreditsOnMerge"]);
  const mixedMergeMethod = useScopedSettingsMixed(["pullRequestMergeMethod"]);
  const modelSource = useScopedSettingSource(["defaultModelSelection"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const unavailable = connectedEnvironments.length === 0;
  const effective = target
    ? resolveProjectSettings(target.settings, null, null, null).settings
    : null;

  const modelDisabledReason = useScopedModelDisabledReason(settings, entries);
  const effortDisabledReason = selection
    ? modelDisabledReason(selection.instanceId, selection.model)
    : null;

  const setModel = (value: ModelSelection | null) => {
    const reason = value ? modelDisabledReason(value.instanceId, value.model) : null;
    if (reason) {
      toastManager.add({
        type: "error",
        title: gt("Default model not saved"),
        description: reason,
      });
      return;
    }
    updateSettings({ defaultModelSelection: value });
  };

  const modelRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultModelSelection"]}
      mixed={mixedModel}
      id="default-model"
      title={gt("Model")}
      status={
        mixedModel
          ? `${automaticModel ? "Automatic defaults differ." : "Defaults differ."} Select one environment or choose a shared model to edit effort.`
          : (presentation.providerNote ??
            effortDisabledReason ??
            (!unavailable && modelSource !== "project" && automaticModel ? "Automatic" : undefined))
      }
      resetAction={
        settings.defaultModelSelection !== null ? (
          <SettingResetButton
            label={gt("default model", { $context: "setting name in a reset button label" })}
            onClick={() => setModel(null)}
          />
        ) : null
      }
      control={
        selection ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              environmentId={representative?.environmentId ?? null}
              activeInstanceId={selection.instanceId}
              model={selection.model}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={modelOptions}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              {...(mixedModel
                ? {
                    triggerLabel: automaticModel
                      ? gt("Automatic (mixed)")
                      : gt("Mixed", { $context: "values differ across targets" }),
                  }
                : {})}
              getModelDisabledReason={modelDisabledReason}
              onOpenProviderSetup={(instanceId) => {
                if (representative)
                  void navigate({
                    to: "/settings/providers",
                    search: { environmentId: representative.environmentId, instanceId },
                  });
              }}
              onInstanceModelChange={(instanceId, model) =>
                setModel(pickModelSelection(mixedModel ? null : selection, instanceId, model))
              }
            />
            {!mixedModel && !presentation.providerNote && !effortDisabledReason && activeEntry ? (
              <TraitsPicker
                provider={activeEntry.driverKind}
                models={activeEntry.models}
                model={selection.model}
                modelOptions={selection.options ?? []}
                allowPromptInjectedEffort={false}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  setModel(createModelSelection(selection.instanceId, selection.model, options))
                }
              />
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            {mixedModel
              ? gt("Mixed", { $context: "values differ across targets" })
              : gt("No providers available")}
          </span>
        )
      }
    />
  );
  const workspaceRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultThreadEnvMode"]}
      mixed={mixedWorkspace}
      id={searchableSetting("new-threads").id}
      title={gt("Workspace")}
      resetAction={
        !isProjectScope && settings.defaultThreadEnvMode !== null ? (
          <SettingResetButton
            label={gt("default workspace", { $context: "setting name in a reset button label" })}
            onClick={() => updateSettings({ defaultThreadEnvMode: null })}
          />
        ) : null
      }
      control={
        <Select
          value={mixedWorkspace ? null : (effective?.defaultThreadEnvMode ?? null)}
          onValueChange={(value) => {
            if (value === "local" || value === "worktree")
              updateSettings({ defaultThreadEnvMode: value });
          }}
        >
          <SelectTrigger size="sm" aria-label={gt("Default workspace")}>
            <SelectValue>
              {(value: string | null) =>
                value === "local" || value === "worktree"
                  ? resolveEnvModeLabel(value, messages)
                  : unavailable
                    ? gt("Unavailable", { $context: "setting value cannot be read" })
                    : gt("Mixed", { $context: "values differ across targets" })
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="local">{resolveEnvModeLabel("local", messages)}</SelectItem>
            <SelectItem value="worktree">{resolveEnvModeLabel("worktree", messages)}</SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );

  const fallbackRow = !isProjectScope ? (
    <SettingsRow
      serverScoped
      settingKeys={["fallbackModelSelection"]}
      mixed={mixedFallback}
      {...searchableSetting("fallback-model")}
      description={gt("Used for new threads when the default model's provider is out of usage.")}
      resetAction={
        mixedFallback || settings.fallbackModelSelection !== null ? (
          <SettingResetButton
            label={gt("fallback model", { $context: "setting name in a reset button label" })}
            onClick={() => updateSettings({ fallbackModelSelection: null })}
          />
        ) : null
      }
      control={
        fallbackSelection ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              environmentId={representative?.environmentId ?? null}
              activeInstanceId={fallbackSelection.instanceId}
              model={fallbackSelection.model}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={fallbackModelOptions}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              triggerAriaLabel={gt("Fallback model")}
              {...(mixedFallback
                ? { triggerLabel: gt("Mixed", { $context: "values differ across targets" }) }
                : settings.fallbackModelSelection === null
                  ? { triggerLabel: gt("None", { $context: "no fallback model" }) }
                  : {})}
              getModelDisabledReason={modelDisabledReason}
              onInstanceModelChange={(instanceId, model) => {
                const reason = modelDisabledReason(instanceId, model);
                if (reason) {
                  toastManager.add({
                    type: "error",
                    title: gt("Fallback model not saved"),
                    description: reason,
                  });
                  return;
                }
                updateSettings({
                  fallbackModelSelection: pickModelSelection(
                    mixedFallback ? null : settings.fallbackModelSelection,
                    instanceId,
                    model,
                  ),
                });
              }}
            />
            {settings.fallbackModelSelection !== null && fallbackEntry && !mixedFallback ? (
              <TraitsPicker
                provider={fallbackEntry.driverKind}
                models={fallbackEntry.models}
                model={fallbackSelection.model}
                modelOptions={fallbackSelection.options ?? []}
                allowPromptInjectedEffort={false}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  updateSettings({
                    fallbackModelSelection: createModelSelection(
                      fallbackSelection.instanceId,
                      fallbackSelection.model,
                      options,
                    ),
                  })
                }
              />
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            <T>No providers available</T>
          </span>
        )
      }
    />
  ) : null;

  return (
    <SettingsSection
      id={category === "source-control" ? "source-control-defaults" : "project-defaults"}
      title={category === "source-control" ? gt("Repositories") : gt("New threads")}
    >
      {category === "project" ? (
        <>
          {modelRow}
          {fallbackRow}
          {workspaceRow}
        </>
      ) : category === "general" ? (
        <>
          {modelRow}
          {fallbackRow}
          <SettingsRow
            serverScoped
            settingKeys={["defaultRuntimeMode"]}
            mixed={mixedPermissions}
            {...searchableSetting("default-permissions")}
            resetAction={
              settings.defaultRuntimeMode !== DEFAULT_SERVER_SETTINGS.defaultRuntimeMode ? (
                <SettingResetButton
                  label={gt("default permissions", {
                    $context: "setting name in a reset button label",
                  })}
                  onClick={() =>
                    updateSettings({
                      defaultRuntimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={mixedPermissions ? null : settings.defaultRuntimeMode}
                onValueChange={(value) => {
                  if (value) updateSettings({ defaultRuntimeMode: value });
                }}
              >
                <SelectTrigger size="sm" aria-label={gt("Default permissions")}>
                  {!mixedPermissions && (
                    <PermissionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <SelectValue>
                    {mixedPermissions
                      ? gt("Mixed", { $context: "values differ across targets" })
                      : messages(runtimeModeConfig[settings.defaultRuntimeMode].label)}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {runtimeModeOptions.map((mode) => {
                    const option = runtimeModeConfig[mode];
                    const Icon = option.icon;
                    return (
                      <SelectItem key={mode} value={mode} className="min-w-64">
                        <div className="grid gap-0.5">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                            {messages(option.label)}
                          </span>
                          <span className="text-xs leading-4 text-muted-foreground">
                            {messages(option.description)}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            }
          />
          {workspaceRow}
        </>
      ) : (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["defaultAutoPull"]}
            mixed={mixedAutoPull}
            id="automatic-pull"
            title={gt("Automatically pull")}
            description={gt("Fast-forward the default branch when the checkout is clean.")}
            resetAction={
              settings.defaultAutoPull !== DEFAULT_SERVER_SETTINGS.defaultAutoPull ? (
                <SettingResetButton
                  label={gt("default automatic pull", {
                    $context: "setting name in a reset button label",
                  })}
                  onClick={() =>
                    updateSettings({ defaultAutoPull: DEFAULT_SERVER_SETTINGS.defaultAutoPull })
                  }
                />
              ) : null
            }
            control={
              <Switch
                aria-label={gt("Default automatic pull")}
                mixed={mixedAutoPull}
                checked={mixedAutoPull ? false : settings.defaultAutoPull}
                onCheckedChange={(enabled) => updateSettings({ defaultAutoPull: enabled })}
              />
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["removeAgentCreditsOnMerge"]}
            mixed={mixedAgentCredits}
            {...searchableSetting("remove-agent-credits-on-merge")}
            description={gt(
              "Keeps human co-authors. Covers auto-merge; skips merge queues and stack merges.",
            )}
            resetAction={
              settings.removeAgentCreditsOnMerge ? (
                <SettingResetButton
                  label={gt("agent credit removal", {
                    $context: "setting name in a reset button label",
                  })}
                  tooltip={gt("Keep agent credits")}
                  onClick={() => updateSettings({ removeAgentCreditsOnMerge: false })}
                />
              ) : null
            }
            control={
              <Switch
                aria-label={gt("Remove agent credits when merging")}
                mixed={mixedAgentCredits}
                checked={mixedAgentCredits ? false : settings.removeAgentCreditsOnMerge}
                onCheckedChange={(enabled) =>
                  updateSettings({ removeAgentCreditsOnMerge: enabled })
                }
              />
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["pullRequestMergeMethod"]}
            mixed={mixedMergeMethod}
            {...searchableSetting("pull-request-merge-method")}
            description={gt("Last selected reuses your most recent choice on this device.")}
            resetAction={
              settings.pullRequestMergeMethod !== null ? (
                <SettingResetButton
                  label={gt("default merge method", {
                    $context: "setting name in a reset button label",
                  })}
                  tooltip={gt("Reset to last selected")}
                  onClick={() => updateSettings({ pullRequestMergeMethod: null })}
                />
              ) : null
            }
            control={
              <Select
                value={mixedMergeMethod ? null : (settings.pullRequestMergeMethod ?? "last")}
                onValueChange={(value) => {
                  if (value === "last") updateSettings({ pullRequestMergeMethod: null });
                  else if (value === "merge" || value === "squash" || value === "rebase")
                    updateSettings({ pullRequestMergeMethod: value });
                }}
              >
                <SelectTrigger size="sm" aria-label={gt("Default pull request merge method")}>
                  <SelectValue>
                    {(value: string | null) =>
                      value === "merge" || value === "squash" || value === "rebase"
                        ? messages(PULL_REQUEST_MERGE_METHOD_LABELS[value])
                        : value === "last"
                          ? gt("Last selected")
                          : gt("Mixed", { $context: "values differ across targets" })
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="last">
                    <T>Last selected</T>
                  </SelectItem>
                  <SelectItem value="merge">
                    {messages(PULL_REQUEST_MERGE_METHOD_LABELS.merge)}
                  </SelectItem>
                  <SelectItem value="squash">
                    {messages(PULL_REQUEST_MERGE_METHOD_LABELS.squash)}
                  </SelectItem>
                  <SelectItem value="rebase">
                    {messages(PULL_REQUEST_MERGE_METHOD_LABELS.rebase)}
                  </SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        </>
      )}
    </SettingsSection>
  );
}

export function AgentBrowserAccessRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["enableAgentBrowserAccess"]);
  return (
    <SettingsRow
      serverScoped
      settingKeys={["enableAgentBrowserAccess"]}
      mixed={mixed}
      {...searchableSetting("agent-browser-access")}
      description={gt("Let agents drive the shared browser. Applies when an agent session starts.")}
      resetAction={
        settings.enableAgentBrowserAccess !== DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess ? (
          <SettingResetButton
            label={gt("default browser access", {
              $context: "setting name in a reset button label",
            })}
            onClick={() =>
              updateSettings({
                enableAgentBrowserAccess: DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          aria-label={gt("Agent browser access")}
          mixed={mixed}
          checked={mixed ? false : settings.enableAgentBrowserAccess}
          onCheckedChange={(enabled) => updateSettings({ enableAgentBrowserAccess: enabled })}
        />
      }
    />
  );
}

export function WorktreeSubmodulesRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const messages = useMessages();
  const { scope, target, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedSubmodules = useScopedSettingsMixed(["worktreeSubmodules"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const unavailable = connectedEnvironments.length === 0;
  const effective = target
    ? resolveProjectSettings(target.settings, null, null, null).settings
    : null;

  return (
    <SettingsRow
      serverScoped
      settingKeys={["worktreeSubmodules"]}
      mixed={mixedSubmodules}
      {...searchableSetting("worktree-submodules")}
      resetAction={
        !isProjectScope && settings.worktreeSubmodules !== null ? (
          <SettingResetButton
            label={gt("worktree submodules", { $context: "setting name in a reset button label" })}
            onClick={() => updateSettings({ worktreeSubmodules: null })}
          />
        ) : null
      }
      control={
        <Select
          value={mixedSubmodules ? null : (effective?.worktreeSubmodules ?? null)}
          onValueChange={(value) => {
            if (isWorktreeSubmodules(value)) updateSettings({ worktreeSubmodules: value });
          }}
        >
          <SelectTrigger size="sm" aria-label={gt("Worktree submodules")}>
            <SelectValue>
              {(value: string | null) =>
                isWorktreeSubmodules(value)
                  ? messages(WORKTREE_SUBMODULES_LABELS[value])
                  : unavailable
                    ? gt("Unavailable", { $context: "setting value cannot be read" })
                    : gt("Mixed", { $context: "values differ across targets" })
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {WORKTREE_SUBMODULES_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {messages(WORKTREE_SUBMODULES_LABELS[option])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

export function StartFromRemoteRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsRow
      serverScoped
      settingKeys={["newWorktreesStartFromOrigin"]}
      {...searchableSetting("start-from-origin")}
      description={gt("Base new worktrees on origin instead of your local branch.")}
      resetAction={
        settings.newWorktreesStartFromOrigin !==
        DEFAULT_SERVER_SETTINGS.newWorktreesStartFromOrigin ? (
          <SettingResetButton
            label={gt("new worktrees start from remote", {
              $context: "setting name in a reset button label",
            })}
            onClick={() =>
              updateSettings({
                newWorktreesStartFromOrigin: DEFAULT_SERVER_SETTINGS.newWorktreesStartFromOrigin,
              })
            }
          />
        ) : null
      }
      control={
        <ScopedSwitch
          settingKeys={["newWorktreesStartFromOrigin"]}
          checked={settings.newWorktreesStartFromOrigin}
          onCheckedChange={(checked) =>
            updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
          }
          aria-label={gt("Start new worktrees from remote by default")}
        />
      }
    />
  );
}
