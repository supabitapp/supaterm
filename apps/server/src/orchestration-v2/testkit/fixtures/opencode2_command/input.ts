import { OPENCODE2_COMMAND_PROMPT, type OrchestratorFixtureInput } from "../shared.ts";

export function openCode2CommandInput() {
  return {
    steps: [{ type: "message", text: OPENCODE2_COMMAND_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
