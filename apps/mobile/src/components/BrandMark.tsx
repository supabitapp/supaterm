import Constants from "expo-constants";
import { Image } from "expo-image";
import { View } from "react-native";

import { AppText as Text } from "./ui/AppText";
import { SUPATERM_BRAND_MARK_SOURCE } from "./brandAssets";
import { T } from "gt-react-native";

const appVariant = Constants.expoConfig?.extra?.appVariant;
const DEFAULT_STAGE_LABEL =
  appVariant === "development" ? "Dev" : appVariant === "preview" ? "Preview" : null;

export function BrandMark(props: { readonly compact?: boolean; readonly stageLabel?: string }) {
  const compact = props.compact ?? false;
  const iconSize = compact ? 32 : 44;
  const stageLabel = props.stageLabel ?? DEFAULT_STAGE_LABEL;

  return (
    <View className="flex-row items-center gap-3">
      <Image
        source={SUPATERM_BRAND_MARK_SOURCE}
        accessibilityIgnoresInvertColors
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: compact ? 10 : 14,
        }}
      />
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-lg font-supaterm-bold tracking-[-0.4px] text-foreground">
            Supaterm
          </Text>
          {stageLabel ? (
            <View className="rounded-full bg-subtle px-2 py-1">
              <Text className="text-3xs font-supaterm-bold tracking-[1.1px] uppercase text-foreground-muted">
                {stageLabel}
              </Text>
            </View>
          ) : null}
        </View>
        {!compact ? (
          <Text className="text-xs font-medium text-foreground-muted">
            <T>Mobile control surface for your live coding environments</T>
          </Text>
        ) : null}
      </View>
    </View>
  );
}
