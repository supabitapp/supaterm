import type { OrchestratorFixtureInput } from "../shared.ts";

export const MALFORMED_SESSION_UPDATE_PROMPT =
  "Respond with the following text: malformed update fixture ok";

export function malformedSessionUpdateInput() {
  return {
    steps: [{ type: "message", text: MALFORMED_SESSION_UPDATE_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
