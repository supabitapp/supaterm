import { type OrchestrationV2Run, RunId } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { nextPromptSuggestionRunId } from "./orchestration.ts";

describe("nextPromptSuggestionRunId", () => {
  const runId = RunId.make("run-1");
  const ready = {
    enabled: true,
    connected: true,
    canSuggest: true,
    latestRun: { runId, status: "completed" },
  } as const;

  it("asks about the thread's latest run once it has completed", () => {
    expect(nextPromptSuggestionRunId(ready)).toBe(runId);
  });

  it("asks about the run a steer continued once the detail shows its queued run cancelled", () => {
    const steered = RunId.make("run-2");
    const run = (id: RunId, ordinal: number, status: OrchestrationV2Run["status"]) =>
      ({
        id,
        ordinal,
        status,
        startedAt: status === "cancelled" ? null : DateTime.makeUnsafe(0),
        completedAt: DateTime.makeUnsafe(ordinal * 1000),
      }) as OrchestrationV2Run;
    const latestRun = { runId: steered, status: "cancelled", startedAt: null } as const;

    expect(nextPromptSuggestionRunId({ ...ready, latestRun })).toBeNull();
    expect(
      nextPromptSuggestionRunId({
        ...ready,
        latestRun,
        runs: [run(runId, 1, "completed"), run(steered, 2, "cancelled")],
      }),
    ).toBe(runId);
  });

  it.each([
    { name: "suggestions are off", input: { ...ready, enabled: false } },
    { name: "the environment is not connected", input: { ...ready, connected: false } },
    { name: "the client may not run models", input: { ...ready, canSuggest: false } },
    {
      name: "the run is still working",
      input: { ...ready, latestRun: { runId, status: "running" } },
    },
    {
      name: "the run was interrupted",
      input: { ...ready, latestRun: { runId, status: "interrupted" } },
    },
    { name: "the thread has no run", input: { ...ready, latestRun: null } },
  ] as const)("does not ask when $name", ({ input }) => {
    expect(nextPromptSuggestionRunId(input)).toBeNull();
  });
});
