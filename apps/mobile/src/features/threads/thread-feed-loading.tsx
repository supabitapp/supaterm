import { useGT } from "gt-react-native";
import { View } from "react-native";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { ThreadLoadingSkeleton, useThreadLoadingShimmer } from "./thread-loading-skeleton";

/** Conversation-shaped NativeMotion skeletons bridge the history request and list positioning. */
export function ThreadFeedLoading(props: {
  readonly topInset: number;
  readonly bottomInset: number;
  readonly horizontalPadding: number;
}) {
  const gt = useGT();
  const { themeAppearance, themeVariables: theme } = useAppearancePreferences();
  const shimmerColor =
    themeAppearance === "dark" ? theme["--color-foreground"] : theme["--color-screen"];
  const shimmer = useThreadLoadingShimmer();
  const skeletonProps = { ...shimmer, shimmerColor };
  return (
    <View
      accessible
      accessibilityLabel={gt("Loading conversation")}
      accessibilityState={{ busy: true }}
      pointerEvents="none"
      style={{
        flex: 1,
        justifyContent: "flex-end",
        paddingTop: props.topInset + 24,
        paddingBottom: props.bottomInset + 24,
        paddingHorizontal: props.horizontalPadding,
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="gap-7"
      >
        <View className="gap-3 px-2">
          <ThreadLoadingSkeleton width="42%" height={10} {...skeletonProps} />
          <ThreadLoadingSkeleton width="86%" {...skeletonProps} />
          <ThreadLoadingSkeleton width="58%" {...skeletonProps} />
        </View>
        <View
          className="self-end gap-3 rounded-2xl bg-user-bubble px-4 py-4"
          style={{ width: "70%" }}
        >
          <ThreadLoadingSkeleton {...skeletonProps} />
          <ThreadLoadingSkeleton width="68%" {...skeletonProps} />
        </View>
        <View className="gap-3 px-2">
          <ThreadLoadingSkeleton width="34%" height={10} {...skeletonProps} />
          <ThreadLoadingSkeleton {...skeletonProps} />
          <ThreadLoadingSkeleton width="92%" {...skeletonProps} />
          <ThreadLoadingSkeleton width="72%" {...skeletonProps} />
        </View>
      </View>
    </View>
  );
}
