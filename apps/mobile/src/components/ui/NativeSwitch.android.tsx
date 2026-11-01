import { NativeThemeHost } from "./NativeThemeHost.android";
import { Switch as ComposeSwitch } from "@expo/ui/jetpack-compose";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import type { ThemedSwitchProps } from "./NativeSwitch.types";

import { useControlTheme } from "./useControlTheme";

/** RN Pressable must own touch: Compose-handled switch taps can activate the parent row instead. */
export function NativeSwitch(props: ThemedSwitchProps) {
  const { colors } = useControlTheme();
  const toggle = () => {
    if (!props.onValueChange) return;
    const value = !props.value;
    void Haptics.performAndroidHapticsAsync(
      value ? Haptics.AndroidHaptics.Toggle_On : Haptics.AndroidHaptics.Toggle_Off,
    );
    props.onValueChange(value);
  };

  return (
    <Pressable
      disabled={props.disabled}
      onPress={toggle}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityHint={props.accessibilityHint}
      accessibilityRole="switch"
      accessibilityState={{ checked: Boolean(props.value), disabled: Boolean(props.disabled) }}
      style={props.style}
      testID={props.testID}
    >
      <View importantForAccessibility="no-hide-descendants" pointerEvents="none">
        <NativeThemeHost ignoreSafeAreaKeyboardInsets style={{ width: 52, height: 48 }}>
          <ComposeSwitch
            value={Boolean(props.value)}
            enabled={!props.disabled}
            colors={{
              checkedTrackColor: colors["--color-switch-active-track"],
              checkedThumbColor: colors["--color-switch-active-thumb"],
              checkedBorderColor: colors["--color-switch-active-track"],
              uncheckedTrackColor: colors["--color-switch-inactive-track"],
              uncheckedThumbColor: colors["--color-switch-inactive-thumb"],
              uncheckedBorderColor: colors["--color-switch-inactive-thumb"],
            }}
          />
        </NativeThemeHost>
      </View>
    </Pressable>
  );
}
