import type { MenuAction } from "@react-native-menu/menu";
import type { AppBarMenuItem } from "./AppBar.types";

export function androidHeaderMenuActions(items: ReadonlyArray<AppBarMenuItem>): MenuAction[] {
  return items.flatMap((item): MenuAction[] =>
    "items" in item
      ? item.inline && !item.title
        ? androidHeaderMenuActions(item.items)
        : [
            {
              id: item.id,
              title: item.title ?? "",
              image: item.icon,
              subactions: androidHeaderMenuActions(item.items),
            },
          ]
      : [
          {
            id: item.id,
            title: item.title,
            subtitle: item.subtitle,
            image: item.icon,
            state: item.selected ? "on" : undefined,
            attributes: item.disabled ? { disabled: true } : undefined,
          },
        ],
  );
}

export function findHeaderMenuAction(
  items: ReadonlyArray<AppBarMenuItem>,
  id: string,
): Extract<AppBarMenuItem, { readonly onPress: () => void }> | undefined {
  for (const item of items) {
    if ("items" in item) {
      const action = findHeaderMenuAction(item.items, id);
      if (action) return action;
    } else if (item.id === id) {
      return item;
    }
  }
  return undefined;
}

export function splitAndroidHeaderActions<Action extends { readonly overflowOnly?: boolean }>(
  actions: ReadonlyArray<Action>,
  wide: boolean,
) {
  const inline = actions.filter((action) => !action.overflowOnly);
  const directCount = actions.length > 2 ? (wide ? 3 : 1) : inline.length;
  const visibleActions = inline.slice(0, directCount);
  return {
    visibleActions,
    overflowActions: actions.filter((action) => !visibleActions.includes(action)),
  };
}

/**
 * Keeps as many actions inline as fit beside a title at least one button wide, moving the rest
 * behind an overflow button that takes one of the slots.
 */
export function fitAndroidHeaderActions<Action>(
  actions: ReadonlyArray<Action>,
  layout: {
    readonly width: number;
    readonly buttonSize: number;
    readonly gap: number;
    readonly reservedButtons: number;
  },
) {
  const slots =
    layout.width === 0
      ? actions.length
      : Math.floor((layout.width - layout.buttonSize) / (layout.buttonSize + layout.gap)) -
        layout.reservedButtons;
  if (actions.length <= slots) return { visibleActions: actions, overflowActions: [] };
  const visibleActions = actions.slice(0, Math.max(0, slots - 1));
  return { visibleActions, overflowActions: actions.slice(visibleActions.length) };
}
