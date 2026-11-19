import { THREAD_GROUPING_OPTIONS } from "@supaterm/client-runtime/state/thread-grouping";
import type { SidebarThreadGrouping } from "@supaterm/contracts";
import type { EnvironmentId } from "@supaterm/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import type { WorkspaceEnvironment } from "../../state/workspaceModel";

export interface HomeListFilterMenuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export function homeListFilterEnvironments(environments: ReadonlyArray<WorkspaceEnvironment>) {
  return Arr.sort(
    environments.flatMap((environment) =>
      environment.isEnabled
        ? [
            {
              environmentId: environment.environmentId,
              label: environment.environmentLabel,
              connectionState: environment.connectionState,
            },
          ]
        : [],
    ),
    Order.mapInput(Order.String, (environment: { readonly label: string }) => environment.label),
  );
}

export interface HomeListFilterMenuProject {
  readonly key: string;
  readonly label: string;
}

type HomeListFilterMenuAction = {
  readonly type: "action";
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly state?: "on" | "off";
  readonly onPress: () => void;
};

export type HomeListFilterMenuSubmenu = {
  readonly type: "submenu";
  readonly title: string;
  readonly items: HomeListFilterMenuAction[];
};

export interface HomeListFilterMenu {
  readonly title: string;
  readonly items: Array<HomeListFilterMenuAction | HomeListFilterMenuSubmenu>;
}

export interface HomeListFilterMenuInput {
  readonly grouping: SidebarThreadGrouping;
  readonly onGroupingChange: (grouping: SidebarThreadGrouping) => void;
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly onResetScope: () => void;
  readonly hideOfflineEnvironments: boolean;
  readonly onHideOfflineEnvironmentsChange: (hide: boolean) => void;
}

export function buildHomeListFilterMenu(props: HomeListFilterMenuInput): HomeListFilterMenu {
  const items: Array<HomeListFilterMenuAction | HomeListFilterMenuSubmenu> = [];

  items.push({
    type: "submenu",
    title: "Grouping",
    items: THREAD_GROUPING_OPTIONS.map((option) => ({
      type: "action",
      id: `grouping:${option.value}`,
      title: option.label,
      state: option.value === props.grouping ? "on" : "off",
      onPress: () => props.onGroupingChange(option.value),
    })),
  });

  items.push({
    type: "submenu",
    title: "Environment",
    items: [
      {
        type: "action",
        id: "environment:all",
        title: "All environments",
        subtitle: "Show threads from every environment",
        state: props.selectedEnvironmentId === null ? "on" : "off",
        onPress: () => props.onEnvironmentChange(null),
      },
      ...props.environments.map((environment) => ({
        type: "action" as const,
        id: `environment:${environment.environmentId}`,
        title: environment.label,
        state:
          props.selectedEnvironmentId === environment.environmentId
            ? ("on" as const)
            : ("off" as const),
        onPress: () => props.onEnvironmentChange(environment.environmentId),
      })),
      {
        type: "action",
        id: "environment:hide-offline",
        title: "Hide offline environments",
        state: props.hideOfflineEnvironments ? "on" : "off",
        onPress: () => props.onHideOfflineEnvironmentsChange(!props.hideOfflineEnvironments),
      },
    ],
  });

  if (props.projects.length > 0) {
    items.push({
      type: "submenu",
      title: "Project",
      items: [
        {
          type: "action",
          id: "project:all",
          title: "All projects",
          subtitle: "Show threads from every project",
          state: props.selectedProjectKey === null ? "on" : "off",
          onPress: () => props.onProjectChange(null),
        },
        ...props.projects.map((project) => ({
          type: "action" as const,
          id: `project:${project.key}`,
          title: project.label,
          state: props.selectedProjectKey === project.key ? ("on" as const) : ("off" as const),
          onPress: () => props.onProjectChange(project.key),
        })),
      ],
    });
  }

  if (props.selectedEnvironmentId !== null || props.selectedProjectKey !== null) {
    items.push({
      type: "action",
      id: "reset",
      title: "Reset filters",
      onPress: props.onResetScope,
    });
  }

  return {
    title: "Thread list options",
    items,
  };
}

/** The thread list options as an `AppBar` menu, for the workspace list header. */
export function buildHomeListFilterMenuItems(props: HomeListFilterMenuInput): AppBarMenuItem[] {
  return buildHomeListFilterMenu(props).items.map((item) =>
    item.type === "submenu"
      ? {
          id: item.title,
          title: item.title,
          items: item.items.map((action) => ({
            id: action.id,
            title: action.title,
            subtitle: action.subtitle,
            selected: action.state === "on",
            onPress: action.onPress,
          })),
        }
      : {
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          selected: item.state === "on",
          onPress: item.onPress,
        },
  );
}
