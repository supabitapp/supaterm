import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { PullRequestsScreen } from "../pull-requests/PullRequestsScreen";
import { PullRequestToolbar } from "../pull-requests/PullRequestToolbar.android";
import { WorkspaceTabsContext, useWorkspaceTabs } from "./WorkspaceTabsContext";
import { WORKSPACE_DOCK } from "./workspace-tabs-state";
import { useWorkspaceDockHeight } from "./useWorkspaceDockHeight";

export function AndroidWorkspaceSidebar(props: {
  readonly children: ReactNode;
  readonly onRequestVisibility: () => void;
  readonly selectedPullRequestKey: string | null;
}) {
  const workspace = useWorkspaceTabs()!;
  const insets = useSafeAreaInsets();
  const dockHeight = useWorkspaceDockHeight();
  const bottomClearance = Math.max(insets.bottom, 12) + WORKSPACE_DOCK.bottomGap + dockHeight + 16;
  const context = useMemo(() => ({ ...workspace, bottomClearance }), [workspace, bottomClearance]);
  return workspace.state.selectedTab === "threads" ? (
    props.children
  ) : (
    <WorkspaceTabsContext value={context}>
      <View className="flex-1 bg-header">
        <PullRequestToolbar sidebar onRequestVisibility={props.onRequestVisibility} />
        <ScreenContent insetHorizontal>
          <PullRequestsScreen sidebar selectedPullRequestKey={props.selectedPullRequestKey} />
        </ScreenContent>
      </View>
    </WorkspaceTabsContext>
  );
}
