import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../state/atom-registry", () => ({}));
vi.mock("../../state/projects", () => ({}));
vi.mock("../../state/preferences", () => ({}));
vi.mock("../../state/use-composer-drafts", () => ({}));

import { resolveStartNewTaskDestination } from "./use-start-new-task";

const project = (id: string) =>
  ({
    environmentId: EnvironmentId.make("environment-1"),
    id: ProjectId.make(id),
    title: id,
  }) as EnvironmentProject;
const remembered = project("remembered");
const first = project("first");
const stickyProject = { environmentId: remembered.environmentId, projectId: remembered.id };

describe("resolveStartNewTaskDestination", () => {
  it("opens a draft in the remembered project", () => {
    expect(
      resolveStartNewTaskDestination({
        stickyProject,
        projects: [first, remembered],
        requestId: "request-1",
        useLastProject: undefined,
      }),
    ).toEqual({
      draft: { requestId: "request-1", environmentId: "environment-1", projectId: "remembered" },
    });
  });

  it.each([
    ["the remembered project is no longer listed", stickyProject, [first], undefined],
    ["nothing is remembered", null, [first], undefined],
    ["Use last project is off", stickyProject, [first, remembered], false],
  ] as const)("asks for a project when %s", (_case, sticky, projects, useLastProject) => {
    expect(
      resolveStartNewTaskDestination({
        stickyProject: sticky,
        projects,
        requestId: "request-1",
        useLastProject,
      }),
    ).toEqual({ draft: { requestId: "request-1" } });
  });
});
