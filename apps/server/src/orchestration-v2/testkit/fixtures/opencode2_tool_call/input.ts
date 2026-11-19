import { OPENCODE2_TOOL_CALL_PROMPT, type OrchestratorFixtureInput } from "../shared.ts";

export function openCode2ToolCallInput() {
  return {
    steps: [{ type: "message", text: OPENCODE2_TOOL_CALL_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
