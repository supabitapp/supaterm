import { PROPOSED_PLAN_PROMPT, type OrchestratorFixtureInput } from "../shared.ts";

export function proposedPlanInput() {
  return {
    interactionMode: "plan",
    steps: [{ type: "message", text: PROPOSED_PLAN_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
