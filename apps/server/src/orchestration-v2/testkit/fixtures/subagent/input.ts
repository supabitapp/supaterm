import { SUBAGENT_PROMPT, type OrchestratorFixtureInput } from "../shared.ts";

export function subagentInput(): OrchestratorFixtureInput;
export function subagentInput() {
  return {
    steps: [{ type: "message", text: SUBAGENT_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
