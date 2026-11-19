import type { AppBarMenu } from "../../../components/ui/AppBar.types";
import type { MenuProps } from "../../../components/ui/Menu.types";
import { appBarMenuItemsFromActions } from "../../../components/ui/menuActionItems";

export interface WorkspaceFilterMenu {
  readonly title: string;
  readonly accessibilityLabel: string;
  readonly actions: MenuProps["actions"];
  readonly onPressAction: NonNullable<MenuProps["onPressAction"]>;
  readonly customized: boolean;
}

export function workspaceFilterAppBarMenu(menu: WorkspaceFilterMenu): AppBarMenu {
  return {
    title: menu.accessibilityLabel,
    status: menu.title,
    icon: menu.customized
      ? "line.3.horizontal.decrease.circle.fill"
      : "line.3.horizontal.decrease.circle",
    items: appBarMenuItemsFromActions(menu.actions, (event) =>
      menu.onPressAction({ nativeEvent: { event } }),
    ),
  };
}
