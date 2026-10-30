import { expect, it } from "vite-plus/test";
import {
  claudeResumeCompactionAge,
  formatClaudeResumeCompactionQuestion,
} from "./claudeCompaction.ts";

it("recognizes an affirmative native compaction answer by question id or text", () => {
  const question = formatClaudeResumeCompactionQuestion({
    ageMinutes: 81,
    estimatedTokens: 245_000,
  });
  expect(
    claudeResumeCompactionAge({
      questionTextById: { resume: question },
      answers: { resume: ["Compact and continue"] },
    }),
  ).toBe("1h 21m");
  expect(claudeResumeCompactionAge({ answers: { [question]: "Compact and continue" } })).toBe(
    "1h 21m",
  );
  expect(claudeResumeCompactionAge({ answers: { [question]: "Don't ask again" } })).toBeNull();
  expect(claudeResumeCompactionAge({ answers: { unrelated: "Compact and continue" } })).toBeNull();
});
