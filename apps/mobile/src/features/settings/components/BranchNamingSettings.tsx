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
import { ListChoiceRow as SettingsChoiceRow } from "../../../components/ui/ListChoiceRow";
import { SettingsSection } from "./SettingsSection";
import { useSettingTextDrafts } from "./useSettingTextDrafts";
import { msg, T, useGT, useMessages } from "gt-react-native";

const MODES = {
  static: {
    label: msg("Static prefix"),
    description: msg("Add your prefix to the generated branch name."),
  },
  repository: {
    label: msg("Repository name prefix"),
    description: msg(
      "Prefix generated branches with the repository name. A fork uses its own name.",
    ),
  },
  semantic: {
    label: msg("Semantic prefix"),
    description: msg("Let the model choose {examples}, or another prefix.", {
      examples: "feat/, fix/, refactor/",
    }),
  },
  custom: {
    label: msg("Custom instructions"),
    description: msg("Generate the complete name with no added prefix or suffix."),
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
  const gt = useGT();
  const m = useMessages();
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
      title={gt("Worktree branch naming")}
      trailing={
        choice === null ? (
          <Text className="text-xs text-foreground-muted">
            <T>Mixed</T>
          </Text>
        ) : null
      }
    >
      {BRANCH_NAMING_CHOICES.map((mode, index) => (
        <SettingsChoiceRow
          key={mode}
          label={m(MODES[mode].label)}
          description={m(MODES[mode].description)}
          selected={choice === mode}
          separated={index > 0}
          disabled={props.disabled}
          onPress={() => props.onChange(branchNamingChoicePatch(mode))}
        />
      ))}
      {choice === "static" ? (
        <View className="gap-2 px-4 py-3">
          <Text className="text-sm text-foreground-muted">
            {gt("Use {short} or {slash} for {example}. Leave empty for no prefix.", {
              short: "supaterm",
              slash: "supaterm/",
              example: "supaterm/add-search",
            })}
          </Text>
          <AppTextInput
            key={props.prefix}
            accessibilityLabel={gt("Branch prefix")}
            onChangeText={(text) => edit("branchNamePrefix", text)}
            defaultValue={props.prefix ?? ""}
            placeholder={props.prefix === null ? gt("Mixed") : gt("No prefix")}
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
            <T>Append instructions to the naming prompt.</T>
          </Text>
          <AppTextInput
            key={props.instructions}
            accessibilityLabel={gt("Branch naming instructions")}
            onChangeText={(text) => edit("branchNameInstructions", text)}
            defaultValue={props.instructions ?? ""}
            placeholder={
              props.instructions === null
                ? gt("Mixed. Enter instructions for all selected targets.")
                : gt("Use {prefix} followed by the issue ID and a short description.", {
                    prefix: "julius/",
                  })
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
