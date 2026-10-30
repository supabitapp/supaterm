import {
  CLAUDE_RESULT_IS_ERROR_FOLLOW_UP,
  CLAUDE_RESULT_IS_ERROR_PROMPT,
  type OrchestratorFixtureInput,
} from "../shared.ts";

export function claudeResultIsErrorInput(): OrchestratorFixtureInput {
  return {
    steps: [
      { type: "message", text: CLAUDE_RESULT_IS_ERROR_PROMPT },
      { type: "message", text: CLAUDE_RESULT_IS_ERROR_FOLLOW_UP },
    ],
  };
}
