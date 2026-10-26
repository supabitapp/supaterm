import {
  AndroidAnchoredMenu,
  type AndroidAnchoredMenuProps,
} from "../../components/ui/AndroidAnchoredMenu";
import { AndroidHeaderIconButton } from "../../components/ui/AndroidScreenHeader";

export function WorkspaceFilterButton(
  props: Pick<AndroidAnchoredMenuProps, "title" | "actions" | "onPressAction"> & {
    readonly accessibilityLabel: string;
    readonly customized: boolean;
  },
) {
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
