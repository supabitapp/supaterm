import { AndroidAnchoredMenu } from "../../components/ui/AndroidAnchoredMenu";
import { AndroidWorkspaceNavigation } from "./AndroidWorkspaceNavigation";
import { WorkspaceDockFrame } from "./WorkspaceDockFrame";
import type { WorkspaceDockProps } from "./WorkspaceDock.types";

export function WorkspaceDock(props: WorkspaceDockProps) {
  return (
    <WorkspaceDockFrame>
      <AndroidAnchoredMenu
        title={props.filterMenu?.title}
        actions={props.filterMenu?.actions ?? []}
        onPressAction={props.filterMenu?.onPressAction}
      >
        {(open) => (
          <AndroidWorkspaceNavigation
            showTabs={props.showTabs !== false}
            filterCustomized={props.filterMenu?.customized ?? false}
            onFilter={open}
            onCompose={props.onNewTask}
          />
        )}
      </AndroidAnchoredMenu>
    </WorkspaceDockFrame>
  );
}
