import { EnvironmentId, ProjectId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { findScopedProject } from "./pullRequestList.logic";
import { pullRequestFilterProjects } from "./pullRequestProjectFilter.logic";

const cups = EnvironmentId.make("env-cups");
const nucbox = EnvironmentId.make("env-nucbox");
const labels = new Map([
  [cups, "cups"],
  [nucbox, "nucbox-1"],
]);

function project(
  id: string,
  environmentId = nucbox,
  canonicalKey: string | null = "github.com/supabitapp/supacode-next",
) {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: "supaterm",
    workspaceRoot: `/work/${id}`,
    repositoryIdentity: canonicalKey === null ? null : { canonicalKey },
    faviconPath: `${id}/favicon.png`,
  };
}

describe("pull request project filter choices", () => {
  it("collapses three checkouts on one server without dropping another server's copy", () => {
    const projects = [
      project("main"),
      project("worktree-1"),
      project("worktree-2"),
      project("main", cups),
    ];

    const choices = pullRequestFilterProjects(projects, labels);

    expect(choices.map(({ id, environmentId, title }) => ({ id, environmentId, title }))).toEqual([
      { id: "main", environmentId: cups, title: "supaterm · cups" },
      { id: "main", environmentId: nucbox, title: "supaterm · nucbox-1" },
    ]);
    expect(choices[1]?.workspaceRoot).toBe("/work/main");
    expect(choices[1]?.faviconPath).toBe("main/favicon.png");
  });

  it("keeps a saved worktree selection as the repository's only choice", () => {
    const projects = [project("main"), project("worktree"), project("worktree", cups)];
    const selected = findScopedProject(projects, nucbox, "worktree");

    const choices = pullRequestFilterProjects(projects, labels, selected);

    expect(choices.filter((choice) => choice.environmentId === nucbox)).toEqual([
      { ...projects[1], title: "supaterm · nucbox-1" },
    ]);
    expect(findScopedProject(choices, nucbox, "worktree")).toBeDefined();
    expect(findScopedProject(choices, nucbox, "main")).toBeUndefined();
    expect(findScopedProject(choices, cups, "worktree")).toBeDefined();
  });

  it("distinguishes same-named repositories on one server by checkout path", () => {
    const projects = [
      project("upstream"),
      project("fork", nucbox, "github.com/juliusmarminge/supaterm"),
    ];

    const choices = pullRequestFilterProjects(projects, labels);

    expect(choices.map((choice) => choice.title)).toEqual([
      "supaterm · nucbox-1 · /work/fork",
      "supaterm · nucbox-1 · /work/upstream",
    ]);
  });

  it("keeps repositories on different hosts separate", () => {
    const choices = pullRequestFilterProjects(
      [
        project("github"),
        project("enterprise", nucbox, "git.example.com/supabitapp/supacode-next"),
      ],
      labels,
    );

    expect(choices.map((choice) => choice.id)).toEqual(["enterprise", "github"]);
  });

  it("does not merge projects whose repository identity is unknown", () => {
    const choices = pullRequestFilterProjects(
      [project("first", nucbox, null), project("second", nucbox, null)],
      labels,
    );

    expect(choices.map((choice) => choice.title)).toEqual([
      "supaterm · nucbox-1 · /work/first",
      "supaterm · nucbox-1 · /work/second",
    ]);
  });

  it("distinguishes servers with the same display name and checkout path", () => {
    const first = project("main");
    const second = project("main", cups);
    const repeatedLabels = new Map([
      [cups, "nucbox-1"],
      [nucbox, "nucbox-1"],
    ]);

    const choices = pullRequestFilterProjects([first, second], repeatedLabels);

    expect(choices.map((choice) => choice.title)).toEqual([
      "supaterm · nucbox-1 · /work/main · env-cups",
      "supaterm · nucbox-1 · /work/main · env-nucbox",
    ]);
  });
});
