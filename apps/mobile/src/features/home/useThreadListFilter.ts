import { useMemo } from "react";

import { pickableProjectGroups } from "@supaterm/client-runtime/state/project-grouping";

import { useProjects } from "../../state/entities";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useLaunchingThreads } from "../../state/use-pending-new-tasks";
import { useWorkspaceState } from "../../state/workspace";
import type { WorkspaceListHeaderProps } from "../layout/workspace/WorkspaceListHeader.types";
import { buildHomeListFilterMenuItems, homeListFilterEnvironments } from "./home-list-filter-menu";
import { useHomeListOptions } from "./home-list-options";
import { useAtomValueWhileVisible } from "./home-route-visibility";
import {
  buildHomeProjectScopes,
  resolveHomeProjectFilterScope,
  sortHomeProjectScopes,
} from "./homeThreadList";

export function useThreadListFilter(visible: boolean) {
  const threads = useLaunchingThreads(
    useAtomValueWhileVisible(steadyNavigationThreadShellsAtom, visible),
  );
  const projects = useProjects();
  const { environments: workspaceEnvironments } = useWorkspaceState();
  const environments = homeListFilterEnvironments(workspaceEnvironments);
  const availableEnvironmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const {
    options: listOptions,
    setSelectedEnvironmentId,
    setSelectedProjectKey,
    resetScope,
    setThreadGrouping,
    setHideOfflineEnvironments,
  } = useHomeListOptions(availableEnvironmentIds);
  const selectedEnvironmentId = listOptions.selectedEnvironmentId;
  const projectScopes = useMemo(
    () =>
      buildHomeProjectScopes({
        projects,
        environmentId: selectedEnvironmentId,
        projectGroupingMode: listOptions.projectGroupingMode,
      }),
    [listOptions.projectGroupingMode, projects, selectedEnvironmentId],
  );
  const projectFilterOptions = useMemo(
    () =>
      pickableProjectGroups(
        sortHomeProjectScopes({
          scopes: projectScopes,
          threads,
          pendingTasks: [],
          projectSortOrder: "updated_at",
        }),
      ).map((scope) => ({
        key: scope.key,
        label: scope.title,
      })),
    [projectScopes, threads],
  );
  const selectedProjectKey =
    resolveHomeProjectFilterScope(projectScopes, projects, listOptions)?.key ?? null;
  const filter: WorkspaceListHeaderProps["filter"] = {
    customized: selectedEnvironmentId !== null || selectedProjectKey !== null,
    items: buildHomeListFilterMenuItems({
      grouping: listOptions.threadGrouping,
      onGroupingChange: setThreadGrouping,
      environments,
      projects: projectFilterOptions,
      selectedEnvironmentId,
      selectedProjectKey,
      onEnvironmentChange: setSelectedEnvironmentId,
      onProjectChange: setSelectedProjectKey,
      onResetScope: resetScope,
      hideOfflineEnvironments: listOptions.hideOfflineEnvironments,
      onHideOfflineEnvironmentsChange: setHideOfflineEnvironments,
    }),
  };
  return { threads, listOptions, projects, environments, selectedProjectKey, filter };
}
