import {
  SUBAGENT_CONTINUE_PARENT_PROMPT,
  SUBAGENT_CONTINUE_PROMPT,
  type OrchestratorFixtureInput,
} from "../shared.ts";

export function subagentContinueInput() {
  return {
    steps: [
      { type: "message", text: SUBAGENT_CONTINUE_PROMPT },
      { type: "message", text: SUBAGENT_CONTINUE_PARENT_PROMPT },
    ],
  } satisfies OrchestratorFixtureInput;
}
