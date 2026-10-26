import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId } from "@supaterm/contracts";
import { assert, it } from "@effect/vitest";

import {
  buildShowcasePendingTasks,
  SHOWCASE_PENDING_TASK_DEFINITIONS,
} from "./showcasePendingTasks";

const projects: ReadonlyArray<EnvironmentProject> = [
  {
    environmentId: EnvironmentId.make("studio-laptop"),
    id: ProjectId.make("supaterm"),
    title: "supaterm",
    workspaceRoot: "/workspace/supaterm",
    repositoryIdentity: null,
    defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    scripts: [],
    createdAt: "2026-07-16T08:00:00.000Z",
    updatedAt: "2026-07-16T08:00:00.000Z",
  },
  {
    environmentId: EnvironmentId.make("basement-tower"),
    id: ProjectId.make("tidepool"),
    title: "tidepool",
    workspaceRoot: "/workspace/tidepool",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-16T08:00:00.000Z",
    updatedAt: "2026-07-16T08:00:00.000Z",
  },
];

it("builds sendable-looking pending tasks against real showcase projects", () => {
  const tasks = buildShowcasePendingTasks(projects, Date.parse("2026-07-16T09:00:00.000Z"));

  assert.equal(tasks.length, SHOWCASE_PENDING_TASK_DEFINITIONS.length);
  assert.deepStrictEqual(
    tasks.map((task) => ({
      environmentId: String(task.environmentId),
      projectId: task.creation ? String(task.creation.projectId) : undefined,
      title: task.creation?.projectTitle,
      branch: task.creation?.branch,
      createdAt: task.createdAt,
    })),
    [
      {
        environmentId: "studio-laptop",
        projectId: "supaterm",
        title: "supaterm",
        branch: "feat/offline-tests",
        createdAt: "2026-07-16T08:52:00.000Z",
      },
      {
        environmentId: "basement-tower",
        projectId: "tidepool",
        title: "tidepool",
        branch: "fix/chart-landscape",
        createdAt: "2026-07-16T08:33:00.000Z",
      },
    ],
  );
  assert.equal(
    tasks.every((task) => task.modelSelection !== undefined),
    true,
  );
});
