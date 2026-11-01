import { describe, expect, it } from "vite-plus/test";

import { splitForMiddleTruncate } from "./middle-truncate";

describe("splitForMiddleTruncate", () => {
  it("keeps the last path segment whole", () => {
    expect(splitForMiddleTruncate("supabitapp/supaterm")).toEqual({
      head: "supabitapp/",
      tail: "supaterm",
    });
  });

  it("does not split a combining sequence", () => {
    expect(splitForMiddleTruncate("prefix-prefix-e\u0301ct-123456")).toEqual({
      head: "prefix-prefix-",
      tail: "e\u0301ct-123456",
    });
  });

  it("does not split a joined emoji", () => {
    expect(splitForMiddleTruncate("prefix-prefix-\u{1F469}\u200D\u{1F4BB}-12345678")).toEqual({
      head: "prefix-prefix-",
      tail: "\u{1F469}\u200D\u{1F4BB}-12345678",
    });
  });

  it("leaves short values whole", () => {
    expect(splitForMiddleTruncate("main")).toBeNull();
  });

  it("starts a long segment's tail on a word, not mid-word", () => {
    expect(splitForMiddleTruncate("supaterm/clone-repo-to-other-machine")?.tail).toBe("machine");
    expect(splitForMiddleTruncate("supaterm/investigate-release-build-times")?.tail).toBe("times");
  });

  it("falls back to an earlier word when the last one is too short", () => {
    expect(splitForMiddleTruncate("supaterm/compare-long-featurenames-ab")?.tail).toBe(
      "featurenames-ab",
    );
  });

  it("keeps the fixed tail when no word break is near", () => {
    expect(splitForMiddleTruncate("supaterm/abcdefghijklmnopqrstuvwxyz")?.tail).toBe("qrstuvwxyz");
  });

  it("respects an explicit tail length", () => {
    expect(splitForMiddleTruncate("supaterm/clone-repo-to-other-machine", 6)?.tail).toBe("achine");
  });
});
