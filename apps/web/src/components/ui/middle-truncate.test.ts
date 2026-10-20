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
});
