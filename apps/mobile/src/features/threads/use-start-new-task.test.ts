import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../state/preferences", () => ({}));
vi.mock("../../state/atom-registry", () => ({}));
vi.mock("../../state/projects", () => ({}));
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
      }),
    ).toEqual({
      draft: { requestId: "request-1", environmentId: "environment-1", projectId: "remembered" },
    });
  });

  it.each([
    ["the remembered project is no longer listed", stickyProject],
    ["nothing is remembered", null],
  ])("opens the picker when %s", (_case, sticky) => {
    expect(
      resolveStartNewTaskDestination({
        stickyProject: sticky,
        projects: [first],
        requestId: "request-1",
      }),
    ).toEqual({ draft: { requestId: "request-1" } });
  });

  it("opens the picker when remembering the project is disabled", () => {
    expect(
      resolveStartNewTaskDestination({
        stickyProject,
        projects: [remembered],
        requestId: "request-1",
        useLastProject: false,
      }),
    ).toEqual({ draft: { requestId: "request-1" } });
  });
  it("opens a projectless draft when there are no projects", () => {
    expect(
      resolveStartNewTaskDestination({ stickyProject, projects: [], requestId: "request-1" }),
    ).toEqual({ draft: { requestId: "request-1" } });
  });
});
