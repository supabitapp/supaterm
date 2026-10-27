import { useCallback, useRef, useState, type ComponentProps } from "react";
import {
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NewThreadButton } from "../../components/NewThreadButton";
import {
  androidHomeFabPosition,
  type AndroidHomeFabLayout as SharedAndroidHomeFabLayout,
} from "./AndroidHomeFab.shared";
import { useWorkspaceState } from "../../state/workspace";
import { FabScrollContext } from "./FabScrollContext";
import { updateFabScroll } from "./fab-scroll";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import {
  FLOATING_TABS,
  floatingTabsMetrics,
  WORKSPACE_TAB_COUNT,
} from "../workspace/floating-workspace-tabs";
import {
  useAndroidFloatingTabs,
  useAppearancePreferences,
} from "../settings/appearance/AppearancePreferencesProvider";

export function AndroidHomeFabLayout(props: ComponentProps<typeof SharedAndroidHomeFabLayout>) {
  const insets = useSafeAreaInsets();
  const { appearance } = useAppearancePreferences();
  const { fontScale } = useWindowDimensions();
  const [layoutWidth, setLayoutWidth] = useState<number | null>(null);
  const { state } = useWorkspaceState();
  const [expanded, setExpanded] = useState(true);
  // One UI keeps compose beside the floating tabs; the sidebar has no tabs to share a row with.
  const floatingTabsEnabled = useAndroidFloatingTabs() && !props.sidebar;
  const { scale, fabSize } = useAndroidControlSizing();
  const floating = floatingTabsMetrics(
    WORKSPACE_TAB_COUNT,
    scale,
    fabSize,
    layoutWidth ?? undefined,
  );
  const scrollState = useRef({ anchor: 0, expanded: true });
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const next = updateFabScroll(
      scrollState.current,
      contentOffset.y,
      contentSize.height - layoutMeasurement.height,
    );
    if (next.expanded !== scrollState.current.expanded) setExpanded(next.expanded);
    scrollState.current = next;
  }, []);

  // Remount only the FAB when its font or pane changes to clear the cached expanded width.
  return (
    <View className="flex-1" onLayout={(event) => setLayoutWidth(event.nativeEvent.layout.width)}>
      <FabScrollContext value={onScroll}>{props.children}</FabScrollContext>
      {state.hasConnections && layoutWidth !== null ? (
        <NewThreadButton
          key={`${appearance.baseFontSize}:${fontScale}:${layoutWidth}`}
          extended
          expanded={floatingTabsEnabled ? false : expanded}
          onPress={props.onStartNewTask}
          className="absolute"
          style={
            floatingTabsEnabled
              ? {
                  right: FLOATING_TABS.edge,
                  bottom: insets.bottom + FLOATING_TABS.bottom + floating.fabOffset,
                }
              : androidHomeFabPosition(insets.bottom, props.sidebar)
          }
        />
      ) : null}
    </View>
  );
}
