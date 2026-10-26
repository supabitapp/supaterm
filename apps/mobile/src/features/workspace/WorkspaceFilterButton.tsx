import { AndroidAnchoredMenu } from "../../components/ui/AndroidAnchoredMenu";
import { AndroidHeaderIconButton } from "../../components/ui/AndroidScreenHeader";
import type { WorkspaceFilterMenu } from "./workspace-filter-menu";

export function WorkspaceFilterButton(props: WorkspaceFilterMenu) {
  return (
    <AndroidAnchoredMenu
      title={props.title}
      actions={props.actions}
      onPressAction={props.onPressAction}
    >
      {(open) => (
        <AndroidHeaderIconButton
          accessibilityLabel={props.accessibilityLabel}
          icon={
            props.customized
              ? "line.3.horizontal.decrease.circle.fill"
              : "line.3.horizontal.decrease.circle"
          }
          onPress={open}
        />
      )}
    </AndroidAnchoredMenu>
  );
}
