import { ProgressView } from "@expo/ui/swift-ui";
import { progressViewStyle, tint } from "@expo/ui/swift-ui/modifiers";
import { View } from "react-native";
import { NativeThemeHost } from "./NativeThemeHost";
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
        <NativeThemeHost matchContents={{ vertical: true }} style={{ width: "100%" }}>
          <ProgressView
            value={progress?.fraction}
            modifiers={[progressViewStyle("linear"), tint(colors["--color-primary"])]}
          />
        </NativeThemeHost>
      )}
    </View>
  );
}

export type { ProgressProps } from "./Progress.types";
