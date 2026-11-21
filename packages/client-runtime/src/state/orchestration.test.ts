import { type OrchestrationV2Run, RunId } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { offeredPromptSuggestion } from "./orchestration.ts";

describe("offeredPromptSuggestion", () => {
  const runId = RunId.make("run-1");
  const suggestion = { runId, text: "add tests" };
  const ready = { suggestion, latestRun: { runId, status: "completed" } } as const;

  it("offers the suggestion once the run that produced it is the latest and completed", () => {
    expect(offeredPromptSuggestion(ready)).toBe(suggestion);
  });

  it("offers the run a steer continued once the detail shows its queued run cancelled", () => {
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

    expect(offeredPromptSuggestion({ ...ready, latestRun })).toBeNull();
    expect(
      offeredPromptSuggestion({
        ...ready,
        latestRun,
        runs: [run(runId, 1, "completed"), run(steered, 2, "cancelled")],
      }),
    ).toBe(suggestion);
  });

  it.each([
    { name: "there is no suggestion", input: { ...ready, suggestion: null } },
    {
      name: "a newer run completed",
      input: { ...ready, latestRun: { runId: RunId.make("run-2"), status: "completed" } },
    },
    {
      name: "the run is still working",
      input: { ...ready, latestRun: { runId, status: "running" } },
    },
    {
      name: "the run was interrupted",
      input: { ...ready, latestRun: { runId, status: "interrupted" } },
    },
    { name: "the thread has no run", input: { ...ready, latestRun: null } },
  ] as const)("offers nothing when $name", ({ input }) => {
    expect(offeredPromptSuggestion(input)).toBeNull();
  });
});
