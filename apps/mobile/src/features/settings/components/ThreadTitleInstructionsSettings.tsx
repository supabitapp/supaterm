import type { ServerSettingsPatch } from "@supaterm/contracts";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { SettingsSection } from "./SettingsSection";
import { useSettingTextDrafts } from "./useSettingTextDrafts";

export function ThreadTitleInstructionsSettings(props: {
  instructions: string | null;
  disabled: boolean;
  onChange: (patch: ServerSettingsPatch) => void;
}) {
  const { edit, save } = useSettingTextDrafts(
    { threadTitleInstructions: props.instructions },
    props.onChange,
  );
  return (
    <SettingsSection title="Thread titles">
      <View className="gap-2 px-4 py-3">
        <Text className="text-sm text-foreground-muted">
          Appended to the prompt for new and regenerated thread titles.
        </Text>
        <AppTextInput
          key={props.instructions}
          accessibilityLabel="Thread title instructions"
          onChangeText={(text) => edit("threadTitleInstructions", text)}
          defaultValue={props.instructions ?? ""}
          placeholder={
            props.instructions === null
              ? "Mixed. Enter instructions for all selected targets."
              : "Keep titles to a few words. Lead with the main subject."
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
