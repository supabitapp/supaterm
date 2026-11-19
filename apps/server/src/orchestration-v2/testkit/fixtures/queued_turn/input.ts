import {
  MULTI_TURN_FIRST_PROMPT,
  MULTI_TURN_SECOND_PROMPT,
  type OrchestratorFixtureInput,
} from "../shared.ts";

export function queuedTurnInput() {
  return {
    steps: [
      { type: "message", text: MULTI_TURN_FIRST_PROMPT },
      { type: "queue_message", text: MULTI_TURN_SECOND_PROMPT },
    ],
  } satisfies OrchestratorFixtureInput;
}
