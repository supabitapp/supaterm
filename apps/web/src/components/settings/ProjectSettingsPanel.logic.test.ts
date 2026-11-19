import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, SourceControlProviderKind } from "@supaterm/contracts";

import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import type { Project } from "../../types";
import {
  projectGroupTitleNeedsUpdate,
  scopeProjectSettingsGroup,
} from "./ProjectSettingsPanel.logic";

const localEnvironmentId = EnvironmentId.make("local");
const remoteEnvironmentId = EnvironmentId.make("remote");
const customIcon = { kind: "lucide", name: "cloud", color: "red" } as const;

function makeProject(environmentId: EnvironmentId, overrides: Partial<Project> = {}) {
  return {
    environmentId,
    id: ProjectId.make(`${environmentId}-project`),
    title: "repo",
    workspaceRoot: `/${environmentId}/repo`,
    repositoryIdentity: {
      canonicalKey: "github.com/owner/repo",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/owner/repo.git",
      },
      provider: SourceControlProviderKind.make("github"),
      owner: "owner",
      name: "repo",
      displayName: "owner/repo",
    },
    defaultModelSelection: null,
    faviconPath: null,
    projectIcon: null,
    scripts: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } satisfies Project;
}

function projectGroup(projects: Project[]) {
  return buildSidebarProjectSnapshots({
    projects,
    settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
    primaryEnvironmentId: localEnvironmentId,
    resolveEnvironmentLabel: (id) => id,
  })[0]!;
}

describe("scopeProjectSettingsGroup", () => {
  it("keeps the sidebar preview identity and edit targets when the remote checkout was registered first", () => {
    const local = makeProject(localEnvironmentId, {
      title: "Local repo",
      faviconPath: "local.svg",
      projectIcon: customIcon,
    });
    const remote = makeProject(remoteEnvironmentId, {
      title: "Remote repo",
      faviconPath: "remote.svg",
    });
    const group = projectGroup([remote, local]);
    const scoped = scopeProjectSettingsGroup(group, group.memberProjects);

    expect(group).toMatchObject(local);
    expect(scoped).toMatchObject(local);
    expect(scoped.memberProjects).toBe(group.memberProjects);
    expect(scoped.memberProjects).toMatchObject([remote, local]);
  });

  it.each([
    [remoteEnvironmentId, "local-project"],
    [localEnvironmentId, "other-checkout"],
  ])("uses the complete selected checkout identity for %s/%s", (environmentId, id) => {
    const local = makeProject(localEnvironmentId, { projectIcon: customIcon });
    const selected = makeProject(environmentId, {
      id: ProjectId.make(id),
      title: "Selected checkout",
      workspaceRoot: "/selected/repo",
      faviconPath: "selected.svg",
      projectIcon: null,
    });
    const group = projectGroup([local, selected]);
    const members = group.memberProjects.filter(
      (member) => member.environmentId === selected.environmentId && member.id === selected.id,
    );
    const scoped = scopeProjectSettingsGroup(group, members);

    expect(scoped).toMatchObject(selected);
    expect(scoped.memberProjects).toBe(members);
    expect(scoped.memberProjects).toMatchObject([selected]);
    expect(group).toMatchObject(local);
  });
});

describe("projectGroupTitleNeedsUpdate", () => {
  const folderTitle = { title: "repo" };
  const renamed = { title: "repo", hasCustomTitle: true };

  it("saves a title that matches the folder default so the rename is recorded", () => {
    expect(projectGroupTitleNeedsUpdate([folderTitle, folderTitle], "repo", true)).toBe(true);
  });

  it("skips untouched fields and renames every member already carries", () => {
    expect(projectGroupTitleNeedsUpdate([folderTitle, { title: "other" }], "repo", false)).toBe(
      false,
    );
    expect(projectGroupTitleNeedsUpdate([renamed, renamed], "repo", true)).toBe(false);
  });
});
