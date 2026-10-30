import { SIMPLE_PROMPT, TURN_INTERRUPT_PROMPT, type OrchestratorFixtureInput } from "../shared.ts";

export function fxEarlyStopInput(): OrchestratorFixtureInput {
  return {
    steps: [
      { type: "message", text: TURN_INTERRUPT_PROMPT },
      { type: "interrupt", targetRunIndex: 1 },
      { type: "message", text: SIMPLE_PROMPT },
    ],
  };
}
