import { OPENCODE2_SIMPLE_PROMPT, type OrchestratorFixtureInput } from "../shared.ts";

export function openCode2SimpleInput() {
  return {
    steps: [{ type: "message", text: OPENCODE2_SIMPLE_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
