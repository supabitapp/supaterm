import { describe, expect, it } from "vite-plus/test";

import { applyDictionary } from "./TranscriptionDictionary.ts";

const dictionary = [
  { term: "Supaterm", aliases: ["super term"] },
  { term: "PostgreSQL", aliases: ["postgres q l"] },
  { term: "Hum", aliases: ["हम"] },
];

describe("applyDictionary", () => {
  it.each([
    ["an alias", "Open super term settings.", "Open Supaterm settings."],
    ["a hyphenated alias", "Open super-term's settings.", "Open Supaterm's settings."],
    ["an alias heard as one word", "Deploy to Superterm.", "Deploy to Supaterm."],
    ["a term in the wrong case", "use SUPATERM and postgresql", "use Supaterm and PostgreSQL"],
    ["an alias spoken across spaces", "back up postgres q   l", "back up PostgreSQL"],
    ["an alias inside a longer word", "supertermination", "supertermination"],
    ["an alias followed by a combining mark", "हमें जाना है।", "हमें जाना है।"],
  ])("spells %s as the dictionary does", (_case, text, expected) => {
    expect(applyDictionary(text, dictionary)).toBe(expected);
  });

  it("ignores a dictionary entry with no letters, which would match everywhere", () => {
    expect(applyDictionary("Run the command.", [{ term: "--", aliases: ["-"] }])).toBe(
      "Run the command.",
    );
  });
});
