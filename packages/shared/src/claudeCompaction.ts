export const CLAUDE_RESUME_COMPACTION_NEVER_ANSWER = "Don't ask again";

export function formatClaudeResumeCompactionQuestion(input: {
  readonly ageMinutes: number;
  readonly estimatedTokens: number;
}): string {
  const ageLabel =
    input.ageMinutes >= 60
      ? `${Math.floor(input.ageMinutes / 60)}h ${input.ageMinutes % 60}m`
      : `${input.ageMinutes}m`;
  return `This session is ${ageLabel} old and uses ${input.estimatedTokens.toLocaleString("en-US")} tokens. Compact it before continuing?`;
}
