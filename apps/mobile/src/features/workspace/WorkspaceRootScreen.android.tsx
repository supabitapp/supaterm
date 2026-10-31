import { useWindowDimensions, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { HomeRouteScreen } from "../home/HomeRouteScreen";
import { PullRequestsScreen } from "../pull-requests/PullRequestsScreen";
import { PullRequestToolbar } from "../pull-requests/PullRequestToolbar.android";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useAndroidFloatingTabs } from "../settings/appearance/AppearancePreferencesProvider";
import { AndroidWorkspaceNavigation, FloatingWorkspaceTabs } from "./AndroidWorkspaceNavigation";
import { FLOATING_TABS, floatingTabsMetrics, WORKSPACE_TAB_COUNT } from "./floating-workspace-tabs";
import { WorkspaceTabsContext, useWorkspaceTabs } from "./WorkspaceTabsContext";

export function WorkspaceRootScreen() {
  const { layout } = useAdaptiveWorkspaceLayout();
  const workspace = useWorkspaceTabs()!;
  const insets = useSafeAreaInsets();
  const floatingTabsEnabled = useAndroidFloatingTabs();
  const { fabClearance, scale, fabSize } = useAndroidControlSizing();
  const window = useWindowDimensions();
  const floating = floatingTabsMetrics(WORKSPACE_TAB_COUNT, scale, fabSize, window.width, true);
  const threadsTab = workspace.state.selectedTab === "threads";
  // The floating pill and compose button sit over the list, so the list pads past them.
  const bottomClearance = floatingTabsEnabled
    ? insets.bottom +
      FLOATING_TABS.bottom +
      FLOATING_TABS.edge +
      Math.max(floating.height, threadsTab ? floating.fabOffset + fabSize : 0)
    : threadsTab
      ? fabClearance + 16
      : 16;
  const context = { ...workspace, bottomClearance };

  if (layout.usesSplitView) {
    return workspace.state.selectedTab === "threads" ? (
      <HomeRouteScreen />
    ) : (
      <>
        <NativeStackScreenOptions options={{ headerShown: false }} />
        <AndroidScreenHeader title="Pull requests" />
        <View className="flex-1 items-center justify-center px-10">
          <EmptyState
            title="Select a pull request"
            detail="Choose a pull request from the sidebar to review it."
            variant="plain"
          />
        </View>
      </>
    );
  }

  return (
    <WorkspaceTabsContext value={context}>
      <View className="flex-1 bg-header">
        <NativeStackScreenOptions options={{ headerShown: false }} />
        <SafeAreaInsetsContext value={floatingTabsEnabled ? insets : { ...insets, bottom: 0 }}>
          <View className="flex-1">
            {workspace.state.selectedTab === "threads" ? (
              <HomeRouteScreen />
            ) : (
              <PullRequestsScreen
                renderFrame={(filters, list) => (
                  <>
                    <PullRequestToolbar filters={filters} />
                    <ScreenContent>{list}</ScreenContent>
                  </>
                )}
              />
            )}
          </View>
        </SafeAreaInsetsContext>
        {floatingTabsEnabled ? <FloatingWorkspaceTabs /> : <AndroidWorkspaceNavigation />}
      </View>
    </WorkspaceTabsContext>
  );
}
