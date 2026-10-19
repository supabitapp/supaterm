import { requireNativeView } from "expo";
import { processColor, View, type NativeSyntheticEvent, type ViewProps } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";

import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { androidWorkspaceNavigationColors } from "./android-workspace-navigation-colors";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { WorkspaceTab } from "./workspace-tabs-state";
import { useWorkspaceTabSelection } from "./useWorkspaceTabSelection";

interface NativeNavigationProps extends ViewProps {
  readonly showTabs: boolean;
  readonly filterCustomized: boolean;
  readonly selectedTab: WorkspaceTab;
  readonly dark: boolean;
  readonly textScale: number;
  readonly containerColor: number;
  readonly selectedColor: number;
  readonly indicatorColor: number;
  readonly unselectedColor: number;
  readonly onTabSelected: (event: NativeSyntheticEvent<{ readonly tab: WorkspaceTab }>) => void;
  readonly onFilterPressed: () => void;
  readonly onCompose: () => void;
}

const NativeNavigation = requireNativeView<NativeNavigationProps>("SupatermWorkspaceNavigation");

function nativeColor(value: string) {
  const color = processColor(value);
  return typeof color === "number" ? color : 0;
}

export function AndroidWorkspaceNavigation(props: {
  readonly showTabs: boolean;
  readonly filterCustomized: boolean;
  readonly onFilter: () => void;
  readonly onCompose: () => void;
}) {
  const workspace = useWorkspaceTabs()!;
  const selectTab = useWorkspaceTabSelection();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const { themeAppearance, themeVariables: colors } = useAppearancePreferences();
  const { scale } = useAndroidControlSizing();
  const { containerColor, indicatorColor, selectedColor, unselectedColor } =
    androidWorkspaceNavigationColors(colors);
  if (keyboardVisible) return null;

  return (
    <View style={{ backgroundColor: containerColor }}>
      <NativeNavigation
        showTabs={props.showTabs}
        filterCustomized={props.filterCustomized}
        selectedTab={workspace.state.selectedTab}
        dark={themeAppearance === "dark"}
        textScale={scale}
        containerColor={nativeColor(containerColor)}
        selectedColor={nativeColor(selectedColor)}
        indicatorColor={nativeColor(indicatorColor)}
        unselectedColor={nativeColor(unselectedColor)}
        onTabSelected={(event) => selectTab(event.nativeEvent.tab)}
        onFilterPressed={props.onFilter}
        onCompose={props.onCompose}
        style={{ height: 80 * Math.max(1, scale) }}
      />
    </View>
  );
}
