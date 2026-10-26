import type { MenuProps } from "../../components/ui/Menu.types";

export interface WorkspaceDockFilterMenu {
  readonly title: string;
  readonly accessibilityLabel: string;
  readonly actions: MenuProps["actions"];
  readonly onPressAction: NonNullable<MenuProps["onPressAction"]>;
  readonly customized: boolean;
}

export interface WorkspaceDockProps {
  readonly onNewTask: () => void;
}
