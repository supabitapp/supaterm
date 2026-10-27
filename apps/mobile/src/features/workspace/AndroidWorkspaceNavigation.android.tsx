import { requireNativeView } from "expo";
import {
  processColor,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { androidWorkspaceNavigationColors } from "./android-workspace-navigation-colors";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { FLOATING_TABS, floatingTabsMetrics, WORKSPACE_TAB_COUNT } from "./floating-workspace-tabs";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { WorkspaceTab } from "./workspace-tabs-state";
import { useWorkspaceTabSelection } from "./useWorkspaceTabSelection";

interface NativeNavigationProps extends ViewProps {
  readonly selectedTab: WorkspaceTab;
  readonly floating: boolean;
  readonly dark: boolean;
  readonly textScale: number;
  readonly containerColor: number;
  readonly selectedColor: number;
  readonly indicatorColor: number;
  readonly unselectedColor: number;
  readonly onTabSelected: (event: NativeSyntheticEvent<{ readonly tab: WorkspaceTab }>) => void;
}

const NativeNavigation = requireNativeView<NativeNavigationProps>("SupatermWorkspaceNavigation");

function nativeColor(value: string) {
  const color = processColor(value);
  return typeof color === "number" ? color : 0;
}

export function AndroidWorkspaceNavigation(props: {
  readonly floating?: boolean;
  readonly paneWidth?: number;
}) {
  const workspace = useWorkspaceTabs()!;
  const selectTab = useWorkspaceTabSelection();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const { themeAppearance, themeVariables: colors } = useAppearancePreferences();
  const { scale, fabSize } = useAndroidControlSizing();
  const window = useWindowDimensions();
  const floating = Boolean(props.floating);
  const metrics = floatingTabsMetrics(
    WORKSPACE_TAB_COUNT,
    scale,
    fabSize,
    props.paneWidth ?? window.width,
    true,
  );
  const { containerColor, indicatorColor, selectedColor, unselectedColor } =
    androidWorkspaceNavigationColors(colors, floating);
  if (keyboardVisible) return null;

  return (
    <View
      style={
        floating ? undefined : { backgroundColor: containerColor, paddingBottom: insets.bottom }
      }
    >
      <NativeNavigation
        selectedTab={workspace.state.selectedTab}
        floating={floating}
        dark={themeAppearance === "dark"}
        textScale={scale}
        containerColor={nativeColor(containerColor)}
        selectedColor={nativeColor(selectedColor)}
        indicatorColor={nativeColor(indicatorColor)}
        unselectedColor={nativeColor(unselectedColor)}
        onTabSelected={(event) => selectTab(event.nativeEvent.tab)}
        style={
          floating
            ? {
                width: metrics.pill + 2 * FLOATING_TABS.shadow,
                height: metrics.height + 2 * FLOATING_TABS.shadow,
              }
            : { height: 80 * Math.max(1, scale) }
        }
      />
    </View>
  );
}

/** One UI's floating pill, left of the compose button in the row above the gesture bar. */
export function FloatingWorkspaceTabs(props: { readonly paneWidth?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: Math.max(insets.left, FLOATING_TABS.edge) - FLOATING_TABS.shadow,
        right: 0,
        bottom: insets.bottom + FLOATING_TABS.bottom - FLOATING_TABS.shadow,
        alignItems: "flex-start",
      }}
    >
      <AndroidWorkspaceNavigation {...props} floating />
    </View>
  );
}
