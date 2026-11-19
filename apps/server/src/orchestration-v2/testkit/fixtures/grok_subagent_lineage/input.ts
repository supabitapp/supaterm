import type { OrchestratorFixtureInput } from "../shared.ts";

const GROK_SUBAGENT_LINEAGE_PROMPT = "audit this codebase";

export function grokSubagentLineageInput() {
  return {
    steps: [{ type: "message", text: GROK_SUBAGENT_LINEAGE_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
