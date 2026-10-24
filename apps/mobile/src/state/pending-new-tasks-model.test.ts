import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId } from "@supaterm/contracts";

import type { ComposerDraft } from "./use-composer-drafts";
import { applyHeldNewTaskDraft, buildPendingDraftTasks } from "./pending-new-tasks-model";

const environmentId = EnvironmentId.make("env-1");
const projectId = ProjectId.make("project-1");

function draft(
  text: string,
  createdAt: string,
  overrides: Partial<ComposerDraft> = {},
): ComposerDraft {
  return {
    text,
    attachments: [],
    project: { environmentId, projectId, createdAt },
    ...overrides,
  };
}

describe("buildPendingDraftTasks", () => {
  it("surfaces every new-task draft with content, newest first", () => {
    const tasks = buildPendingDraftTasks({
      "new-task:draft-old": draft("first idea", "2026-09-05T09:00:00.000Z", {
        workspaceSelection: { mode: "worktree", branch: "main", worktreePath: null },
      }),
      "new-task:draft-new": draft("second idea", "2026-09-05T11:00:00.000Z"),
    });

    expect(tasks.map((task) => [task.title, task.branch])).toEqual([
      ["second idea", null],
      ["first idea", "main"],
    ]);
    expect(tasks[1]).toMatchObject({
      key: "draft-task:new-task:draft-old",
      environmentId,
      projectId,
      draftKey: "new-task:draft-old",
      createdAt: "2026-09-05T09:00:00.000Z",
    });
  });
});

describe("applyHeldNewTaskDraft", () => {
  const otherProjectId = ProjectId.make("project-2");
  const tasks = (drafts: Record<string, ComposerDraft>) =>
    buildPendingDraftTasks({
      "new-task:other": draft("other idea", "2026-09-05T08:00:00.000Z"),
      ...drafts,
    });
  const titles = (drafts: Record<string, ComposerDraft>) => tasks(drafts).map((task) => task.title);
  const held = { draftKey: "new-task:open", content: { text: "first words", attachments: [] } };

  it("keeps the held text while the user types", () => {
    const drafts = { "new-task:open": draft("first words and more", "2026-09-05T09:00:00.000Z") };

    expect(titles(applyHeldNewTaskDraft(drafts, held))).toEqual(["first words", "other idea"]);
  });

  it("keeps the row while the user clears the text", () => {
    const drafts = { "new-task:open": draft("", "2026-09-05T09:00:00.000Z") };

    expect(titles(applyHeldNewTaskDraft(drafts, held))).toEqual(["first words", "other idea"]);
  });

  it("files the row under the draft's current project", () => {
    const drafts = {
      "new-task:open": draft("first words and more", "2026-09-05T09:00:00.000Z", {
        project: {
          environmentId,
          projectId: otherProjectId,
          createdAt: "2026-09-05T09:00:00.000Z",
        },
      }),
    };

    expect(
      tasks(applyHeldNewTaskDraft(drafts, held)).map((task) => [task.title, task.projectId]),
    ).toEqual([
      ["first words", otherProjectId],
      ["other idea", projectId],
    ]);
  });

  it("hides a draft that had no row when it opened", () => {
    const drafts = { "new-task:open": draft("fresh idea", "2026-09-05T09:00:00.000Z") };

    expect(
      titles(applyHeldNewTaskDraft(drafts, { draftKey: "new-task:open", content: null })),
    ).toEqual(["other idea"]);
  });

  it("drops the row once the draft is sent or discarded", () => {
    const drafts = { "new-task:open": { text: "", attachments: [] } };

    expect(titles(applyHeldNewTaskDraft(drafts, held))).toEqual(["other idea"]);
  });

  it("leaves the drafts alone when nothing is held", () => {
    const drafts = { "new-task:open": draft("idea", "2026-09-05T09:00:00.000Z") };

    expect(applyHeldNewTaskDraft(drafts, null)).toBe(drafts);
  });
});
