import { describe, expect, it } from "vite-plus/test";

import { resolveSubagentRowPresentation } from "./threadAgentsPresentation";

const base = {
  title: null,
  prompt: "Audit the timestamps",
  status: "running" as const,
  result: null,
  childThreadId: "thread-child" as never,
};

describe("resolveSubagentRowPresentation", () => {
  it("falls back to a trimmed prompt when the agent has no title", () => {
    const long = resolveSubagentRowPresentation({ ...base, prompt: "x".repeat(200) });
    const titled = resolveSubagentRowPresentation({ ...base, title: "Subagent: /root/my_worker" });

    expect(long.title).toHaveLength(80);
    expect(long.title.endsWith("…")).toBe(true);
    expect(titled.title).toBe("My Worker");
  });
});
