import {
  SUBAGENT_V2_PROMPT,
  SUBAGENT_V2_NESTED_PROMPT,
  type OrchestratorFixtureInput,
} from "../shared.ts";

export function subagentV2Input() {
  return {
    steps: [{ type: "message", text: SUBAGENT_V2_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}

export function subagentV2NestedInput() {
  return {
    steps: [{ type: "message", text: SUBAGENT_V2_NESTED_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
