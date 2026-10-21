import { useMemo } from "react";
import type { MenuProps } from "../../components/ui/Menu.types";
import { buildHomeListFilterMenu, type HomeListFilterMenuInput } from "./home-list-filter-menu";

export function useThreadListFilterMenu(props: HomeListFilterMenuInput) {
  const {
    environments,
    projects,
    selectedEnvironmentId,
    selectedProjectKey,
    onEnvironmentChange,
    onProjectChange,
    grouping,
    onGroupingChange,
  } = props;
  const menu = useMemo(() => {
    const definition = buildHomeListFilterMenu({
      environments,
      projects,
      selectedEnvironmentId,
      selectedProjectKey,
      onEnvironmentChange,
      onProjectChange,
      grouping,
      onGroupingChange,
    });
    const handlers = new Map<string, () => void>();
    const actions = definition.items.map((item, index) => {
      const id = String(index);
      if (item.type === "action") {
        handlers.set(id, item.onPress);
        return { id, title: item.title, state: item.state, subtitle: item.subtitle };
      }
      return {
        id,
        title: item.title,
        subactions: item.items.map((action, childIndex) => {
          const childId = `${id}:${childIndex}`;
          handlers.set(childId, action.onPress);
          return {
            id: childId,
            title: action.title,
            state: action.state,
            subtitle: action.subtitle,
          };
        }),
      };
    });
    const onPressAction: NonNullable<MenuProps["onPressAction"]> = ({ nativeEvent }) => {
      handlers.get(nativeEvent.event)?.();
    };
    return { title: definition.title, actions, onPressAction };
  }, [
    environments,
    projects,
    selectedEnvironmentId,
    selectedProjectKey,
    onEnvironmentChange,
    onProjectChange,
    grouping,
    onGroupingChange,
  ]);
  return {
    ...menu,
    accessibilityLabel: "Filter threads",
    customized: props.selectedEnvironmentId !== null || props.selectedProjectKey !== null,
  };
}
