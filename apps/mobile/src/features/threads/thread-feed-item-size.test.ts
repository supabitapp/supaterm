import { describe, expect, it } from "vite-plus/test";

import { threadWorkRowNeedsMeasurement } from "./thread-feed-item-size";

describe("threadWorkRowNeedsMeasurement", () => {
  it("keeps unopened rows on the fixed-size path", () => {
    expect(threadWorkRowNeedsMeasurement("tool", {})).toBe(false);
  });

  it("measures open details and keeps measuring through collapse", () => {
    expect(threadWorkRowNeedsMeasurement("tool", { tool: true })).toBe(true);
    expect(threadWorkRowNeedsMeasurement("tool", { tool: false })).toBe(true);
    expect(threadWorkRowNeedsMeasurement("other", { tool: false })).toBe(false);
  });
});
