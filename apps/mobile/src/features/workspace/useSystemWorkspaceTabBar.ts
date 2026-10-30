import { Platform } from "react-native";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { useDeviceType, useNativeLayoutMetrics } from "../../native/native-layout-metrics";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { workspaceUsesColumns } from "./workspace-tabs-state";

function useWorkspacePage() {
  const workspace = useWorkspaceTabs();
  return (
    workspace !== null && !workspaceUsesColumns(workspace.state.selectedTab, workspace.settingsOpen)
  );
}

export function useSidebarWorkspaceTabs(): "picker" | "toolbar" | null {
  const { layout } = useAdaptiveWorkspaceLayout();
  const deviceType = useDeviceType();
  const metrics = useNativeLayoutMetrics();
  const page = useWorkspacePage();
  if (Platform.OS !== "ios" || !layout.usesSplitView || page) return null;
  if (deviceType === "pad") return null;

  if (deviceType === "duo-unfolded" && (metrics?.verticalBarEdge ?? "none") === "none")
    return "picker";
  return (metrics?.verticalBarEdge ?? "none") === "none" ? "toolbar" : null;
}

export function useCompactWorkspaceTabs() {
  const { layout } = useAdaptiveWorkspaceLayout();
  return Platform.OS === "ios" && layout.primarySidebarOverlaysContent;
}

export function useFloatingWorkspaceTabs() {
  const { layout } = useAdaptiveWorkspaceLayout();
  const deviceType = useDeviceType();
  const compactTabs = useCompactWorkspaceTabs();
  return (
    NATIVE_LIQUID_GLASS_SUPPORTED &&
    (compactTabs || (deviceType === "pad" && !layout.usesSplitView))
  );
}

export function useSystemWorkspaceTabBar() {
  const deviceType = useDeviceType();
  const { layout } = useAdaptiveWorkspaceLayout();
  const sidebarTabs = useSidebarWorkspaceTabs();
  const compactTabs = useCompactWorkspaceTabs();
  return (
    Platform.OS === "ios" &&
    deviceType !== "pad" &&
    !layout.primarySidebarOverlaysContent &&
    sidebarTabs === null &&
    !compactTabs
  );
}
