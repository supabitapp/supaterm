import { describe, expect, it } from "vite-plus/test";

import { sanitizeCommitSubject, sanitizeNextPrompt } from "./textGenerationUtils.ts";

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
  it("unwraps quotes and folds the reply onto one line", () => {
    expect(sanitizeNextPrompt(' "yes,  score rows\non the same shots" ')).toBe(
      "yes, score rows on the same shots",
    );
  });

  it.each([
    { name: "empty", raw: "  " },
    { name: "only quotes", raw: '""' },
    { name: "too long to accept verbatim", raw: "run it ".repeat(40) },
  ])("offers nothing when the reply is $name", ({ raw }) => {
    expect(sanitizeNextPrompt(raw)).toBeNull();
  });
});
