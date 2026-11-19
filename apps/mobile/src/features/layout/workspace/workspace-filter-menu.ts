import type { AppBarMenu, AppBarMenuItem } from "../../../components/ui/AppBar.types";
import type { MenuProps } from "../../../components/ui/Menu.types";
import {
  appBarMenuItemsFromActions,
  findAppBarMenuItem,
  menuActionsFromAppBarItems,
} from "../../../components/ui/menuActionItems";

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

export function workspaceFilterMenuFromAppBarItems(
  menu: Omit<WorkspaceFilterMenu, "actions" | "onPressAction"> & {
    readonly items: ReadonlyArray<AppBarMenuItem>;
  },
): WorkspaceFilterMenu {
  return {
    title: menu.title,
    accessibilityLabel: menu.accessibilityLabel,
    customized: menu.customized,
    actions: menuActionsFromAppBarItems(menu.items),
    onPressAction: ({ nativeEvent }) =>
      findAppBarMenuItem(menu.items, nativeEvent.event)?.onPress(),
  };
}
