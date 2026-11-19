import type { MenuAction } from "@react-native-menu/menu";
import type { AppBarMenuItem } from "./AppBar.types";

/** Adapts a `MenuAction` tree and its selection handler to `AppBar` menu items. */
export function appBarMenuItemsFromActions(
  actions: ReadonlyArray<MenuAction>,
  onSelect: (id: string) => void,
): AppBarMenuItem[];
export function appBarMenuItemsFromActions(
  actions: ReadonlyArray<MenuAction>,
  onSelect: (id: string) => void,
) {
  return actions.map((action, index) => {
    const id = action.id ?? String(index);
    return action.subactions?.length
      ? {
          id,
          title: action.title,
          icon: action.image,
          items: appBarMenuItemsFromActions(action.subactions, onSelect),
        }
      : {
          id,
          title: action.title,
          subtitle: action.subtitle,
          icon: action.image,
          iconColor: action.imageColor,
          selected: action.state === "on",
          disabled: action.attributes?.disabled,
          onPress: () => onSelect(id),
        };
  }) satisfies AppBarMenuItem[];
}

/** Adapts `AppBar` menu items to a `Menu`'s actions; `findAppBarMenuItem` resolves a selection. */
export function menuActionsFromAppBarItems(items: ReadonlyArray<AppBarMenuItem>): MenuAction[];
export function menuActionsFromAppBarItems(items: ReadonlyArray<AppBarMenuItem>) {
  return items.flatMap(
    (item) =>
      ("items" in item
        ? item.inline && !item.title
          ? menuActionsFromAppBarItems(item.items)
          : [
              {
                id: item.id,
                title: item.title ?? "",
                image: item.icon,
                displayInline: item.inline,
                subactions: menuActionsFromAppBarItems(item.items),
              },
            ]
        : [
            {
              id: item.id,
              title: item.title,
              subtitle: item.subtitle,
              image: item.icon,
              imageColor: item.iconColor,
              state: item.selected ? "on" : undefined,
              attributes:
                item.disabled || item.destructive
                  ? { disabled: item.disabled, destructive: item.destructive }
                  : undefined,
            },
          ]) satisfies MenuAction[] as MenuAction[],
  ) satisfies MenuAction[];
}

export function findAppBarMenuItem(
  items: ReadonlyArray<AppBarMenuItem>,
  id: string,
): Extract<AppBarMenuItem, { readonly onPress: () => void }> | undefined;
export function findAppBarMenuItem(items: ReadonlyArray<AppBarMenuItem>, id: string) {
  for (const item of items) {
    if ("items" in item) {
      const action = findAppBarMenuItem(item.items, id);
      if (action)
        return action satisfies
          | Extract<AppBarMenuItem, { readonly onPress: () => void }>
          | undefined;
    } else if (item.id === id) {
      return item satisfies Extract<AppBarMenuItem, { readonly onPress: () => void }> | undefined;
    }
  }
  return undefined satisfies Extract<AppBarMenuItem, { readonly onPress: () => void }> | undefined;
}
