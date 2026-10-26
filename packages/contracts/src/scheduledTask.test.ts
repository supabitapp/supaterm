import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ScheduledTaskListResult } from "./scheduledTask.ts";

const decodeList = Schema.decodeUnknownSync(Schema.toCodecJson(ScheduledTaskListResult));

describe("ScheduledTaskListResult", () => {
  const task = {
    id: "task-1",
    title: "Nightly triage",
    prompt: "Triage new issues.",
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
    projectId: "project-1",
    threadId: null,
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
  };

  it("keeps the tasks it can read when a newer server sends one it cannot", () => {
    const webhook = {
      ...task,
      id: "task-2",
      schedule: { type: "webhook", signature: null },
    };
    expect(decodeList({ tasks: [task, webhook] }).tasks.map(({ id }) => id)).toEqual(["task-1"]);
  });
});
