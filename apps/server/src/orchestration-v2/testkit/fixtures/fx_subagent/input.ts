import { SUBAGENT_PROMPT, type OrchestratorFixtureInput } from "../shared.ts";

export function fxSubagentInput(): OrchestratorFixtureInput {
  return {
    runtimeMode: "auto",
    steps: [{ type: "message", text: SUBAGENT_PROMPT }],
  };
}
