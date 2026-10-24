import { describe, expect, it } from "vite-plus/test";

import { resolveParkedInsertion } from "./clips.ts";
import { extractVoiceSlot, placeVoiceSlot, spliceTranscriptAt, VOICE_SLOT } from "./voiceSlot.ts";

const captured = {
  ownerKey: "env:thread",
  text: "Fix the cache.",
  selection: { start: 14, end: 14 },
  revision: 3,
};

describe("voice slots", () => {
  it("replaces the captured selection and survives trimming and prefixes", () => {
    const placed = placeVoiceSlot("Fix the flaky cache.", { start: 8, end: 13 });
    expect(placed).toBe(`Fix the ${VOICE_SLOT} cache.`);
    expect(extractVoiceSlot(`ultrathink: ${placed}`.trim())).toEqual({
      text: "ultrathink: Fix the  cache.",
      insertAt: "ultrathink: Fix the ".length,
    });
  });

  it("keeps a single slot when the text already carried one", () => {
    const placed = placeVoiceSlot(`a${VOICE_SLOT}b`, { start: 3, end: 3 });
    expect(placed).toBe(`ab${VOICE_SLOT}`);
  });

  it("appends when the slot was lost", () => {
    expect(extractVoiceSlot("typed")).toEqual({ text: "typed", insertAt: 5 });
  });

  it("splices the transcript with English boundaries and rejects silence", () => {
    expect(spliceTranscriptAt("Fix the cache.", 14, "Then run tests.", "en-US")).toBe(
      "Fix the cache. Then run tests.",
    );
    expect(spliceTranscriptAt("", 0, "Hello", "en-US")).toBe("Hello");
    expect(spliceTranscriptAt("Fix", 99, "now", "en-US")).toBe("Fix now");
    expect(spliceTranscriptAt("Fix", 3, "   ", "en-US")).toBeNull();
  });
});

describe("resolveParkedInsertion", () => {
  it("inserts only into the untouched draft it was recorded over", () => {
    expect(
      resolveParkedInsertion({ captured, current: captured, transcript: "More.", locale: "en" }),
    ).toEqual({
      kind: "commit",
      text: "Fix the cache. More.",
      selection: { start: 20, end: 20 },
    });
    for (const current of [
      { ...captured, revision: 4 },
      { ...captured, text: "Fix the cache!" },
      { ...captured, ownerKey: "env:other" },
      null,
    ]) {
      expect(
        resolveParkedInsertion({ captured, current, transcript: "More.", locale: "en" }),
      ).toEqual({ kind: "ready" });
    }
  });

  it("waits for an explicit insert after recovery and reports silence", () => {
    expect(
      resolveParkedInsertion({
        captured: null,
        current: captured,
        transcript: "More.",
        locale: "en",
      }),
    ).toEqual({ kind: "ready" });
    expect(
      resolveParkedInsertion({ captured, current: captured, transcript: " ", locale: "en" }),
    ).toEqual({ kind: "empty" });
  });
});
