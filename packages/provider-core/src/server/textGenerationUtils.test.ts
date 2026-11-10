import { describe, expect, it } from "vite-plus/test";

import {
  limitSection,
  sanitizeCommitSubject,
  sanitizeNextPrompt,
  sanitizeThreadTitle,
} from "./textGenerationUtils.ts";

describe("limitSection", () => {
  it("cuts a long section without splitting an emoji", () => {
    expect(limitSection(`${"a".repeat(9)}🚀 more`, 10)).toBe(`${"a".repeat(9)}\n\n[truncated]`);
  });
});

describe("sanitizeCommitSubject", () => {
  it.each([
    { name: "an emoji", prefixLength: 71, character: "🚀" },
    { name: "an accented character", prefixLength: 71, character: "e\u0301" },
    { name: "a joined emoji", prefixLength: 65, character: "👨‍👩‍👧‍👦" },
  ])("keeps $name intact at the subject limit", ({ prefixLength, character }) => {
    const prefix = "a".repeat(prefixLength);

    expect(sanitizeCommitSubject(`${prefix}${character} more`)).toBe(prefix);
  });
});

describe("sanitizeNextPrompt", () => {
  it.each([
    { raw: "run the tests", expected: "run the tests" },
    { raw: ' "switch it to the test clock" ', expected: "switch it to the test clock" },
    { raw: "<suggestion>commit this</suggestion>", expected: "commit this" },
    { raw: "Suggestion: push it", expected: "push it" },
    { raw: "yes", expected: "yes" },
    { raw: "yes,  score rows on the same shots", expected: "yes, score rows on the same shots" },
  ])("keeps what a user would type: $raw", ({ raw, expected }) => {
    expect(sanitizeNextPrompt(raw)).toBe(expected);
  });

  it.each([
    { name: "empty", raw: "  " },
    { name: "a refusal to suggest", raw: "Nothing to suggest." },
    { name: "staying silent", raw: "(stay silent)" },
    { name: "one word that is not a yes", raw: "continue" },
    { name: "more than twelve words", raw: "run it ".repeat(13) },
    { name: "several sentences", raw: "Fix it. Then run the tests" },
    { name: "several lines", raw: "fix it\nthen run the tests" },
    { name: "markdown", raw: "run **all** the tests" },
    { name: "a question", raw: "what about mobile?" },
    { name: "praise", raw: "looks good, thanks" },
    { name: "the agent's voice", raw: "I'll run the tests now" },
    { name: "an error", raw: "API Error: overloaded" },
  ])("offers nothing for $name", ({ raw }) => {
    expect(sanitizeNextPrompt(raw)).toBeNull();
  });
});

describe("sanitizeThreadTitle", () => {
  it.each([
    { name: "a split surrogate pair", prefixLength: 116, character: "🚀", retained: "" },
    { name: "a complete surrogate pair", prefixLength: 115, character: "🚀", retained: "🚀" },
    { name: "a BMP character", prefixLength: 116, character: "界", retained: "界" },
  ])("truncates without splitting $name", ({ prefixLength, character, retained }) => {
    const prefix = "a".repeat(prefixLength);
    const title = `${prefix}${character} more`;

    expect(sanitizeThreadTitle(title)).toBe(`${prefix}${retained}...`);
  });
});
