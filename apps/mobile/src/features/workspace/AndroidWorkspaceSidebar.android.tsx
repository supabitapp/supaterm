import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { PullRequestsScreen } from "../pull-requests/PullRequestsScreen";
import { PullRequestToolbar } from "../pull-requests/PullRequestToolbar.android";
import { WorkspaceTabsContext, useWorkspaceTabs } from "./WorkspaceTabsContext";

export function AndroidWorkspaceSidebar(props: {
  readonly children: ReactNode;
  readonly onRequestVisibility: () => void;
  readonly selectedPullRequestKey: string | null;
}) {
  const workspace = useWorkspaceTabs()!;
  const context = useMemo(() => ({ ...workspace, bottomClearance: 16 }), [workspace]);
  return workspace.state.selectedTab === "threads" ? (
    props.children
  ) : (
    <WorkspaceTabsContext value={context}>
      <PullRequestsScreen
        sidebar
        selectedPullRequestKey={props.selectedPullRequestKey}
        renderFrame={(filters, list) => (
          <View className="flex-1 bg-header">
            <PullRequestToolbar
              sidebar
              filters={filters}
              onRequestVisibility={props.onRequestVisibility}
            />
            <ScreenContent insetHorizontal>{list}</ScreenContent>
          </View>
        )}
      />
    </WorkspaceTabsContext>
  );
}
