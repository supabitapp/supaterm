import { Toolbar } from "../../../components/ui/Toolbar";
import type { WorkspaceFilterMenu } from "./workspace-filter-menu";
import { workspaceListFilterIcon } from "./WorkspaceListHeader.types";

function invokeFilterAction(menu: WorkspaceFilterMenu, id: string | undefined) {
  menu.onPressAction({ nativeEvent: { event: id ?? "" } });
}

/** A toolbar's filter menu. Returns an element because toolbars read their direct children. */
export function workspaceFilterToolbarMenu(filterMenu: WorkspaceFilterMenu) {
  return (
    <Toolbar.Menu
      key="workspace-filter"
      accessibilityLabel={filterMenu.accessibilityLabel}
      icon={workspaceListFilterIcon(filterMenu.customized)}
    >
      {filterMenu.actions.map((action) =>
        action.subactions ? (
          <Toolbar.Menu
            key={action.id ?? action.title}
            title={action.title}
            inline={action.displayInline}
          >
            {action.subactions.map((subaction) => (
              <Toolbar.MenuAction
                key={subaction.id ?? subaction.title}
                disabled={subaction.attributes?.disabled}
                destructive={subaction.attributes?.destructive}
                isOn={subaction.state === "on"}
                subtitle={subaction.subtitle}
                onPress={() => invokeFilterAction(filterMenu, subaction.id)}
              >
                {subaction.title}
              </Toolbar.MenuAction>
            ))}
          </Toolbar.Menu>
        ) : (
          <Toolbar.MenuAction
            key={action.id ?? action.title}
            disabled={action.attributes?.disabled}
            destructive={action.attributes?.destructive}
            isOn={action.state === "on"}
            subtitle={action.subtitle}
            onPress={() => invokeFilterAction(filterMenu, action.id)}
          >
            {action.title}
          </Toolbar.MenuAction>
        ),
      )}
    </Toolbar.Menu>
  );
}
