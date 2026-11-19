import { type OrchestratorFixtureInput, WEB_SEARCH_PROMPT } from "../shared.ts";

export function webSearchInput() {
  return {
    steps: [{ type: "message", text: WEB_SEARCH_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
