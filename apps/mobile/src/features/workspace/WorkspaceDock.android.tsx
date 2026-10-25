import { useKeyboardState } from "react-native-keyboard-controller";
import { AndroidAnchoredMenu } from "../../components/ui/AndroidAnchoredMenu";
import { AndroidWorkspaceNavigation } from "./AndroidWorkspaceNavigation";
import type { WorkspaceDockProps } from "./WorkspaceDock.types";

export function WorkspaceDock(props: WorkspaceDockProps) {
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  if (keyboardVisible) return null;
  return (
    <AndroidAnchoredMenu
      className="absolute inset-x-0 bottom-0 z-[5]"
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
  );
}
