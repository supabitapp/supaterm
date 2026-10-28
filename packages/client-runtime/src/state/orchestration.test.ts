import { RunId } from "@supaterm/contracts";
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
