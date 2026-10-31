import {
  BRANCH_NAMING_CHOICES,
  type BranchNamingChoice,
  branchNamingChoiceOf,
  branchNamingChoicePatch,
  type BranchNamingMode,
  type ServerSettingsPatch,
} from "@supaterm/contracts";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { SettingsChoiceRow } from "./SettingsChoiceRow";
import { SettingsSection } from "./SettingsSection";
import { useSettingTextDrafts } from "./useSettingTextDrafts";

const MODES = {
  static: { label: "Static prefix", description: "Add your prefix to the generated branch name." },
  repository: {
    label: "Repository name prefix",
    description: "Prefix generated branches with the repository name. A fork uses its own name.",
  },
  semantic: {
    label: "Semantic prefix",
    description: "Let the model choose feat/, fix/, refactor/, or another prefix.",
  },
  custom: {
    label: "Custom instructions",
    description: "Generate the complete name with no added prefix or suffix.",
  },
} satisfies Record<BranchNamingChoice, { label: string; description: string }>;

export function BranchNamingSettings(props: {
  mode: BranchNamingMode | null;
  prefixFromRepository: boolean | null;
  prefix: string | null;
  instructions: string | null;
  disabled: boolean;
  onChange: (patch: ServerSettingsPatch) => void;
}) {
  const { edit, save } = useSettingTextDrafts(
    { branchNamePrefix: props.prefix, branchNameInstructions: props.instructions },
    props.onChange,
  );
  const choice =
    props.mode === null || props.prefixFromRepository === null
      ? null
      : branchNamingChoiceOf(props.mode, props.prefixFromRepository);
  return (
    <SettingsSection
      title="Worktree branch naming"
      trailing={
        choice === null ? <Text className="text-xs text-foreground-muted">Mixed</Text> : null
      }
    >
      {BRANCH_NAMING_CHOICES.map((mode, index) => (
        <SettingsChoiceRow
          key={mode}
          label={MODES[mode].label}
          description={MODES[mode].description}
          selected={choice === mode}
          separated={index > 0}
          disabled={props.disabled}
          onPress={() => props.onChange(branchNamingChoicePatch(mode))}
        />
      ))}
      {choice === "static" ? (
        <View className="gap-2 px-4 py-3">
          <Text className="text-sm text-foreground-muted">
            Use supaterm or supaterm/ for supaterm/add-search. Leave empty for no prefix.
          </Text>
          <AppTextInput
            key={props.prefix}
            accessibilityLabel="Branch prefix"
            onChangeText={(text) => edit("branchNamePrefix", text)}
            defaultValue={props.prefix ?? ""}
            placeholder={props.prefix === null ? "Mixed" : "No prefix"}
            editable={!props.disabled}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
            onEndEditing={() => save("branchNamePrefix")}
          />
        </View>
      ) : null}
      {choice === "custom" ? (
        <View className="gap-2 px-4 py-3">
          <Text className="text-sm text-foreground-muted">
            Append instructions to the naming prompt.
          </Text>
          <AppTextInput
            key={props.instructions}
            accessibilityLabel="Branch naming instructions"
            onChangeText={(text) => edit("branchNameInstructions", text)}
            defaultValue={props.instructions ?? ""}
            placeholder={
              props.instructions === null
                ? "Mixed. Enter instructions for all selected targets."
                : "Use julius/ followed by the issue ID and a short description."
            }
            editable={!props.disabled}
            multiline
            autoCapitalize="sentences"
            className="min-h-24 rounded-xl px-3 py-2 text-base text-foreground"
            onEndEditing={() => save("branchNameInstructions")}
          />
        </View>
      ) : null}
    </SettingsSection>
  );
}
