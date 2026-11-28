import { LinearProgressIndicator } from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { View } from "react-native";
import { NativeThemeHost } from "./NativeThemeHost.android";
import { useForegroundMotion } from "../../lib/useForegroundMotion";
import { useControlTheme } from "./useControlTheme";
import { resolveProgress, type ProgressProps } from "./Progress.types";

export function Progress(props: ProgressProps) {
  const progress = resolveProgress(props);
  const motionEnabled = useForegroundMotion();
  const { colors } = useControlTheme();
  return (
    <View
      className={props.className}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={props.label}
      accessibilityValue={
        progress === undefined ? undefined : { min: 0, max: 100, now: progress.now }
      }
      accessibilityState={{ busy: progress === undefined }}
    >
      {!motionEnabled && progress === undefined ? (
        <View className="h-1 rounded-full bg-primary/30" />
      ) : (
        <View importantForAccessibility="no-hide-descendants">
          <NativeThemeHost matchContents={{ vertical: true }} style={{ width: "100%" }}>
            <LinearProgressIndicator
              progress={progress?.fraction}
              color={colors["--color-primary"]}
              trackColor={colors["--color-subtle"]}
              modifiers={[fillMaxWidth()]}
            />
          </NativeThemeHost>
        </View>
      )}
    </View>
  );
}
