import { Keyboard } from "react-native";

import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { WorkspaceTab } from "./workspace-tabs-state";

export function useSelectWorkspaceTab() {
  const dispatch = useWorkspaceTabs()?.dispatch;
  const { openWorkspaceTab } = useAdaptiveWorkspaceLayout();
  return (tab: WorkspaceTab | "settings") => {
    Keyboard.dismiss();
    openWorkspaceTab(tab);
    if (tab !== "settings") dispatch?.({ type: "select", tab });
  };
}
