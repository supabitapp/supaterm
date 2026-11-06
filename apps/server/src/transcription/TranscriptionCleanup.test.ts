import { describe, expect, it } from "vite-plus/test";

import { cleanTranscript } from "./TranscriptionCleanup.ts";

const dictionary = [
  { term: "Supaterm", aliases: ["super term"] },
  { term: "PostgreSQL", aliases: ["postgres q l"] },
];

describe("cleanTranscript", () => {
  it.each([
    ["a leading filler", "Um, let's ship it.", "en", "Let's ship it."],
    [
      "fillers between words",
      "So, uh, I think um we should, hmm, wait.",
      "en",
      "So, I think we should, wait.",
    ],
    ["a filler before a full stop", "That's it, um. Next one.", "en", "That's it. Next one."],
    ["a filler that opens a later sentence", "Done. Uh, what now?", "en", "Done. What now?"],
    ["Portuguese 'um', which is a word", "Tenho um gato, uh.", "pt", "Tenho um gato."],
    ["words that contain a filler", "The umbrella hummed.", "en", "The umbrella hummed."],
  ])("removes %s", (_case, text, language, expected) => {
    expect(cleanTranscript(text, { language, removeFillerWords: true, dictionary: [] })).toBe(
      expected,
    );
  });

  it.each([
    ["an alias", "Open super term settings.", "Open Supaterm settings."],
    ["a hyphenated alias", "Open super-term's settings.", "Open Supaterm's settings."],
    ["an alias heard as one word", "Deploy to Superterm.", "Deploy to Supaterm."],
    ["a term in the wrong case", "use SUPATERM and postgresql", "use Supaterm and PostgreSQL"],
    ["an alias spoken across spaces", "back up postgres q   l", "back up PostgreSQL"],
    ["an alias inside a longer word", "supertermination", "supertermination"],
  ])("spells %s as the dictionary does", (_case, text, expected) => {
    expect(cleanTranscript(text, { language: "en", removeFillerWords: false, dictionary })).toBe(
      expected,
    );
  });

  it("leaves fillers alone when the setting is off", () => {
    expect(
      cleanTranscript("Um, okay.", { language: "en", removeFillerWords: false, dictionary: [] }),
    ).toBe("Um, okay.");
  });
});
