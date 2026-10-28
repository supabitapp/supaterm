import { describe, expect, it } from "vite-plus/test";

import { resolveTimelineMinimapPreview } from "./timelineMinimapItems";

describe("resolveTimelineMinimapPreview", () => {
  it("previews a thread autolink as prose, not its URL", () => {
    const preview = resolveTimelineMinimapPreview({
      id: "turn-1",
      rowIndex: 0,
      pinned: false,
      userText: null,
      assistantText:
        "Started <supaterm-thread://v2/env-1/thread-1> and [Fix CI](supaterm-thread://v2/env-1/t2).",
    });
    expect(preview?.assistantText).toBe("Started a thread and Fix CI.");
  });
});
