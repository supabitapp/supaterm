import type { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { WorkspaceEnvironment } from "../../state/workspaceModel";
import {
  buildHomeListFilterMenu,
  buildHomeListFilterMenuItems,
  homeListFilterEnvironments,
} from "./home-list-filter-menu";

describe("buildHomeListFilterMenu", () => {
  it("adds a project scope submenu that selects and clears the same scope as the chips", () => {
    const onProjectChange = vi.fn();
    const onResetScope = vi.fn();
    const input = {
      grouping: "status",
      onGroupingChange: vi.fn(),
      environments: [],
      projects: [
        { key: "environment-1:project-1", label: "Codething" },
        { key: "environment-1:project-2", label: "Website" },
      ],
      selectedEnvironmentId: null,
      selectedProjectKey: "environment-1:project-1",
      onEnvironmentChange: vi.fn(),
      onProjectChange,
      onResetScope,
      hideOfflineEnvironments: false,
      onHideOfflineEnvironmentsChange: vi.fn(),
    } as const;
    const menu = buildHomeListFilterMenu(input);

    const projectMenu = menu.items.find(
      (item) => item.type === "submenu" && item.title === "Project",
    );
    expect(menu.items.map((item) => item.title)).toEqual([
      "Grouping",
      "Environment",
      "Project",
      "Reset filters",
    ]);
    expect(projectMenu).toMatchObject({
      type: "submenu",
      items: [
        { title: "All projects", state: "off" },
        { title: "Codething", state: "on" },
        { title: "Website", state: "off" },
      ],
    });
    if (projectMenu?.type !== "submenu") throw new Error("Expected project submenu");

    projectMenu.items[0]?.onPress();
    projectMenu.items[2]?.onPress();
    expect(onProjectChange).toHaveBeenNthCalledWith(1, null);
    expect(onProjectChange).toHaveBeenNthCalledWith(2, "environment-1:project-2");

    const reset = menu.items.at(-1);
    if (reset?.type !== "action") throw new Error("Expected reset action");
    reset.onPress();
    expect(onResetScope).toHaveBeenCalledOnce();

    // Native menus resolve a delayed tap by ID, so IDs must not follow position.
    const projectItems = buildHomeListFilterMenuItems(input).find((item) => item.id === "Project");
    expect(projectItems).toMatchObject({
      items: [
        { id: "project:all" },
        { id: "project:environment-1:project-1" },
        { id: "project:environment-1:project-2" },
      ],
    });
  });
});

function environment(
  environmentId: string,
  environmentLabel: string,
  isEnabled: boolean,
): WorkspaceEnvironment {
  return {
    environmentId: environmentId as EnvironmentId,
    environmentLabel,
    displayUrl: "",
    isEnabled,
    connectionState: isEnabled ? "connected" : "available",
    connectionError: null,
    connectionErrorTraceId: null,
  };
}

it("offers only switched-on environments, sorted by label", () => {
  expect(
    homeListFilterEnvironments([
      environment("env-studio", "Studio", true),
      environment("env-laptop", "Laptop", false),
      environment("env-desk", "Desk", true),
    ]),
  ).toEqual([
    { environmentId: "env-desk", label: "Desk", connectionState: "connected" },
    { environmentId: "env-studio", label: "Studio", connectionState: "connected" },
  ]);
});
