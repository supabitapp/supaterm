import { NATIVE_WORKSPACE_COLUMNS_SUPPORTED } from "../native/NativeWorkspaceColumns";
import Constants from "expo-constants";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { useState } from "react";
import { Platform, View } from "react-native";

import { AppText as Text } from "./ui/AppText";
import { IPAD_HOME_TITLE_OFFSET } from "../lib/layoutMetrics";
import { resolveMobileStageLabel } from "../lib/mobileBranding";
import { useAndroidControlSizing } from "./ui/useAndroidControlSizing";

/**
 * Horizontal correction applied to content rendered in the brand title slot,
 * shared with the connection subtitle so both align identically.
 */
export function brandTitleOffset(): number {
  if (Platform.OS !== "ios") return 0;
  return Platform.isPad && !NATIVE_WORKSPACE_COLUMNS_SUPPORTED ? IPAD_HOME_TITLE_OFFSET : 0;
}

export function CompactBrandTitle(
  props: {
    readonly allowFontScaling?: boolean;
    readonly accessibilityLabel?: string;
    /**
     * Spans the title column, drops the stage badge when the full title does not fit, then
     * truncates the wordmark. Narrow Android sidebar headers otherwise draw their actions over it.
     */
    readonly fit?: boolean;
  } = {},
) {
  const stageLabel = resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant);
  const titleOffset = brandTitleOffset();
  const { scale } = useAndroidControlSizing();
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  // Measured only while the badge shows, so hiding it does not make it look like it fits.
  const [fullWidth, setFullWidth] = useState<number | null>(null);
  const showStage =
    stageLabel !== null &&
    (!props.fit || availableWidth === null || fullWidth === null || fullWidth <= availableWidth);
  // Truncating while the badge shows would clamp the measured width and keep the badge forever.
  const truncate = props.fit && !showStage;

  const title = (
    <View
      onLayout={
        props.fit && showStage ? (event) => setFullWidth(event.nativeEvent.layout.width) : undefined
      }
      aria-level={1}
      accessibilityLabel={props.accessibilityLabel ?? "Supaterm, Threads"}
      accessible
      role="heading"
      className="flex-row items-center gap-1.5"
      style={[
        { marginLeft: titleOffset },
        Platform.OS === "android" && { gap: 5.25 * scale },
        props.fit && { flexShrink: truncate ? 1 : 0 },
      ]}
    >
      <Text
        allowFontScaling={props.allowFontScaling}
        numberOfLines={truncate ? 1 : undefined}
        className="font-supaterm-bold text-foreground-muted"
        style={[
          { fontSize: 21 * scale, letterSpacing: -0.5 * scale },
          truncate && { flexShrink: 1 },
        ]}
      >
        Supaterm
      </Text>
      {showStage ? (
        <View
          className="rounded-full bg-subtle px-1.5 py-0.5"
          style={
            Platform.OS === "android"
              ? { paddingHorizontal: 5.25 * scale, paddingVertical: 1.75 * scale }
              : undefined
          }
        >
          <Text
            allowFontScaling={props.allowFontScaling}
            className="font-supaterm-bold text-foreground-muted uppercase"
            style={{ fontSize: 9 * scale, letterSpacing: 0.9 * scale }}
          >
            {stageLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return props.fit ? (
    <View
      className="min-w-0 flex-row items-center self-stretch"
      onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
    >
      {title}
    </View>
  ) : (
    title
  );
}

export function renderCompactBrandTitle() {
  return <CompactBrandTitle allowFontScaling={Platform.OS === "ios"} />;
}

export function getCompactBrandHeaderOptions(
  fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"],
): NativeStackNavigationOptions {
  return {
    headerTitle: renderCompactBrandTitle,
    headerTitleStyle: fallbackTitleStyle,
    title: "Threads",
    unstable_headerLeftItems: undefined,
  };
}
