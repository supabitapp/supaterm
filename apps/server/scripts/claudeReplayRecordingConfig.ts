import type { recordClaudeAgentSdkReplayTranscript } from "../src/orchestration-v2/Adapters/ClaudeAdapterV2.testkit.ts";

export type ClaudeRecordingQueryMode = NonNullable<
  Parameters<typeof recordClaudeAgentSdkReplayTranscript>[0]["queryMode"]
>;

export function validateClaudeReplayRecordingSelection(input: {
  readonly scenario: string;
  readonly configuredQueryMode: ClaudeRecordingQueryMode;
  readonly selectedQueryMode: ClaudeRecordingQueryMode;
  readonly configuredPromptCount: number;
  readonly selectedPromptCount: number;
}): void {
  if (input.selectedQueryMode !== input.configuredQueryMode) {
    throw new Error(
      `Claude replay fixture '${input.scenario}' uses query mode '${input.configuredQueryMode}', not '${input.selectedQueryMode}'. Select a scenario configured for the requested query mode.`,
    );
  }
  if (input.selectedPromptCount !== input.configuredPromptCount) {
    throw new Error(
      `Claude replay fixture '${input.scenario}' requires exactly ${input.configuredPromptCount} prompt(s) for query mode '${input.configuredQueryMode}', but received ${input.selectedPromptCount}.`,
    );
  }
}
