import {
  MESSAGE_STEERING_INITIAL_PROMPT,
  MESSAGE_STEERING_STEER_PROMPT,
  type OrchestratorFixtureInput,
} from "../shared.ts";

export function messageSteeringInput() {
  return {
    steps: [
      { type: "message", text: MESSAGE_STEERING_INITIAL_PROMPT },
      {
        type: "steer",
        text: MESSAGE_STEERING_STEER_PROMPT,
        targetRunIndex: 1,
      },
    ],
  } satisfies OrchestratorFixtureInput;
}

export function messageRestartInput(): OrchestratorFixtureInput;
export function messageRestartInput() {
  return {
    steps: [
      { type: "message", text: MESSAGE_STEERING_INITIAL_PROMPT },
      {
        type: "restart",
        text: MESSAGE_STEERING_STEER_PROMPT,
        targetRunIndex: 1,
      },
    ],
  } satisfies OrchestratorFixtureInput;
}
