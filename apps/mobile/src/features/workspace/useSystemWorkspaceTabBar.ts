import { Platform } from "react-native";
import { useSidebarWorkspaceTabs } from "./useSidebarWorkspaceTabs";

export function useSystemWorkspaceTabBar() {
  const sidebarTabs = useSidebarWorkspaceTabs();
  return Platform.OS === "ios" && sidebarTabs === null;
}
