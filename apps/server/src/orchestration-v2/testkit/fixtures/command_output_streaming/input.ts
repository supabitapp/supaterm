import { COMMAND_OUTPUT_STREAMING_PROMPT, type OrchestratorFixtureInput } from "../shared.ts";

export function commandOutputStreamingInput() {
  return {
    steps: [{ type: "message", text: COMMAND_OUTPUT_STREAMING_PROMPT }],
  } satisfies OrchestratorFixtureInput;
}
