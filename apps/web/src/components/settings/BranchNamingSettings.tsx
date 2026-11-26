import { useRef } from "react";
import {
  BRANCH_NAMING_CHOICES,
  type BranchNamingChoice,
  branchNamingChoiceOf,
  branchNamingChoicePatch,
  DEFAULT_SERVER_SETTINGS,
} from "@supaterm/contracts";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useGT, msg, useMessages } from "gt-react";

const MODES = {
  static: msg("Static prefix"),
  repository: msg("Repository name prefix"),
  semantic: msg("Semantic prefix"),
  custom: msg("Custom instructions"),
} satisfies Record<BranchNamingChoice, string>;

const MODE_STATUS: Partial<Record<BranchNamingChoice, string>> = {
  repository: msg(
    "Branches start with the repository name, such as supaterm/add-search. A fork uses its own name.",
  ),
  semantic: msg(
    "The model chooses a prefix that describes the work, such as feat/add-search, fix/login-timeout, or refactor/auth.",
  ),
};

const DEFAULT_CHOICE = branchNamingChoiceOf(
  DEFAULT_SERVER_SETTINGS.branchNamingMode,
  DEFAULT_SERVER_SETTINGS.branchNamePrefixFromRepository,
);

export function BranchNamingSettings() {
  const messages = useMessages();
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const prefixEdited = useRef(false);
  const instructionsEdited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const modeMixed = useScopedSettingsMixed(["branchNamingMode", "branchNamePrefixFromRepository"]);
  const choice = branchNamingChoiceOf(
    settings.branchNamingMode,
    settings.branchNamePrefixFromRepository,
  );
  const prefixMixed = useScopedSettingsMixed(["branchNamePrefix"]);
  const instructionsMixed = useScopedSettingsMixed(["branchNameInstructions"]);

  return (
    <>
      <SettingsRow
        serverScoped
        settingKeys={["branchNamingMode", "branchNamePrefixFromRepository"]}
        {...searchableSetting("worktree-branch-naming")}
        status={
          modeMixed || MODE_STATUS[choice] === undefined ? undefined : messages(MODE_STATUS[choice])
        }
        resetAction={
          choice !== DEFAULT_CHOICE || modeMixed ? (
            <SettingResetButton
              label={gt("branch naming", { $context: "setting name in a reset button label" })}
              onClick={() => updateSettings(branchNamingChoicePatch(DEFAULT_CHOICE))}
            />
          ) : null
        }
        control={
          <Select
            value={modeMixed ? null : choice}
            onValueChange={(value) => {
              if (BRANCH_NAMING_CHOICES.includes(value as BranchNamingChoice)) {
                updateSettings(branchNamingChoicePatch(value as BranchNamingChoice));
              }
            }}
          >
            <SelectTrigger size="sm" aria-label={gt("Worktree branch naming")}>
              <SelectValue>
                {(value: BranchNamingChoice | null) =>
                  value === null
                    ? gt("Mixed", { $context: "values differ across targets" })
                    : messages(MODES[value])
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {BRANCH_NAMING_CHOICES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {messages(MODES[mode])}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {!modeMixed && choice === "static" ? (
        <SettingsRow
          serverScoped
          settingKeys={["branchNamePrefix"]}
          title={gt("Branch prefix")}
          description={gt("{prefix} gives {example}. Leave empty for no prefix.", {
            prefix: "supaterm/",
            example: "supaterm/add-search",
          })}
          resetAction={
            prefixMixed ||
            settings.branchNamePrefix !== DEFAULT_SERVER_SETTINGS.branchNamePrefix ? (
              <SettingResetButton
                label={gt("branch prefix", { $context: "setting name in a reset button label" })}
                onClick={() =>
                  updateSettings({ branchNamePrefix: DEFAULT_SERVER_SETTINGS.branchNamePrefix })
                }
              />
            ) : null
          }
          control={
            <Input
              key={`${scopeKey}:${prefixMixed}:${settings.branchNamePrefix}`}
              aria-label={gt("Branch prefix")}
              autoCapitalize="none"
              spellCheck={false}
              onChange={() => {
                prefixEdited.current = true;
              }}
              placeholder={
                prefixMixed
                  ? gt("Mixed", { $context: "values differ across targets" })
                  : gt("No prefix")
              }
              defaultValue={prefixMixed ? "" : settings.branchNamePrefix}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (prefixEdited.current && (prefixMixed || value !== settings.branchNamePrefix))
                  updateSettings({ branchNamePrefix: value });
                prefixEdited.current = false;
              }}
            />
          }
        />
      ) : null}
      {!modeMixed && choice === "custom" ? (
        <SettingsRow
          serverScoped
          settingKeys={["branchNameInstructions"]}
          title={gt("Branch naming instructions")}
          description={gt("Appended to the naming prompt. The model returns the full branch name.")}
          resetAction={
            instructionsMixed || settings.branchNameInstructions !== "" ? (
              <SettingResetButton
                label={gt("branch naming instructions", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() => updateSettings({ branchNameInstructions: "" })}
              />
            ) : null
          }
        >
          <div className="mt-3 max-w-2xl pb-3.5">
            <Textarea
              key={`${scopeKey}:${instructionsMixed}:${settings.branchNameInstructions}`}
              aria-label={gt("Branch naming instructions")}
              onChange={() => {
                instructionsEdited.current = true;
              }}
              rows={4}
              defaultValue={instructionsMixed ? "" : settings.branchNameInstructions}
              placeholder={
                instructionsMixed
                  ? gt("Mixed. Enter instructions to apply to all selected targets.")
                  : gt("Use julius/ followed by the issue ID and a short description.")
              }
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (
                  instructionsEdited.current &&
                  (instructionsMixed || value !== settings.branchNameInstructions)
                )
                  updateSettings({ branchNameInstructions: value });
                instructionsEdited.current = false;
              }}
            />
          </div>
        </SettingsRow>
      ) : null}
    </>
  );
}
