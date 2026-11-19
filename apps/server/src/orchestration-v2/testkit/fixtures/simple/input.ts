import { SIMPLE_PROMPT, type OrchestratorFixtureInput } from "../shared.ts";

export function simpleInput() {
  return {
    steps: [{ type: "message", text: SIMPLE_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
