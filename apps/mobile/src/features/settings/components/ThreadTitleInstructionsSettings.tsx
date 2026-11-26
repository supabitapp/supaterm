import type { ServerSettingsPatch } from "@supaterm/contracts";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { SettingsSection } from "./SettingsSection";
import { useSettingTextDrafts } from "./useSettingTextDrafts";
import { T, useGT } from "gt-react-native";

export function ThreadTitleInstructionsSettings(props: {
  instructions: string | null;
  disabled: boolean;
  onChange: (patch: ServerSettingsPatch) => void;
}) {
  const gt = useGT();
  const { edit, save } = useSettingTextDrafts(
    { threadTitleInstructions: props.instructions },
    props.onChange,
  );
  return (
    <SettingsSection title={gt("Thread titles")}>
      <View className="gap-2 px-4 py-3">
        <Text className="text-sm text-foreground-muted">
          <T>Appended to the prompt for new and regenerated thread titles.</T>
        </Text>
        <AppTextInput
          key={props.instructions}
          accessibilityLabel={gt("Thread title instructions")}
          onChangeText={(text) => edit("threadTitleInstructions", text)}
          defaultValue={props.instructions ?? ""}
          placeholder={
            props.instructions === null
              ? gt("Mixed. Enter instructions for all selected targets.")
              : gt("Keep titles to a few words. Lead with the main subject.")
          }
          editable={!props.disabled}
          multiline
          autoCapitalize="sentences"
          className="min-h-24 rounded-xl px-3 py-2 text-base text-foreground"
          onEndEditing={() => save("threadTitleInstructions")}
        />
      </View>
    </SettingsSection>
  );
}
