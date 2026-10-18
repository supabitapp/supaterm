import { Platform } from "react-native";
import { useDeviceType, useNativeLayoutMetrics } from "../../native/native-layout-metrics";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";

/** Where an iOS split window shows the workspace tabs instead of UIKit's tab bar. */
export function useSidebarWorkspaceTabs(): "picker" | "toolbar" | null {
  const { layout } = useAdaptiveWorkspaceLayout();
  const deviceType = useDeviceType();
  const metrics = useNativeLayoutMetrics();
  if (Platform.OS !== "ios" || !layout.usesSplitView) return null;
  if (deviceType === "pad") return "picker";
  // The Duo's side rail carries UIKit's tabs. Unfolded in portrait it has no
  // rail, so the tabs sit in the thread list's own toolbar.
  return (metrics?.verticalBarEdge ?? "none") === "none" ? "toolbar" : null;
}
