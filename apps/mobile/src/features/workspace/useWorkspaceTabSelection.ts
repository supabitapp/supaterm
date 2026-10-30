import { StackActions, useNavigation } from "@react-navigation/native";
import { useCallback } from "react";
import { Keyboard, Platform } from "react-native";

import { resetAndroidWorkspace } from "../../lib/android-workspace-navigation";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { WorkspaceTab } from "./workspace-tabs-state";

export function useWorkspaceTabSelection() {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs()!;
  return useCallback(
    (tab: WorkspaceTab) => {
      if (tab === workspace.state.selectedTab) return;
      Keyboard.dismiss();
      if (Platform.OS === "android") {
        resetAndroidWorkspace(navigation);
      } else if (navigation.getState()?.index) {
        navigation.dispatch(StackActions.popToTop());
      }
      workspace.dispatch({ type: "select", tab });
    },
    [navigation, workspace],
  );
}
