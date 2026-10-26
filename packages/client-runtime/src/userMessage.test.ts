import { describe, expect, it } from "vite-plus/test";

import { resolveUserMessagePresentation } from "./userMessage.ts";

describe("resolveUserMessagePresentation", () => {
  it("attributes only agent-sent user messages", () => {
    const text = "Review this area";
    for (const message of [
      { role: "user", createdBy: "user" as const },
      { role: "user" },
      { role: "assistant", createdBy: "agent" as const },
    ]) {
      expect(resolveUserMessagePresentation({ ...message, text })).toEqual({
        text,
        attribution: null,
        scheduledTaskId: undefined,
      });
    }
    expect(resolveUserMessagePresentation({ role: "user", createdBy: "agent", text })).toEqual({
      text,
      attribution: "agent",
      scheduledTaskId: undefined,
    });
  });

  it("attributes server-sent messages to Supaterm, not another agent", () => {
    const text = "Note: the Supaterm server restarted.";
    expect(
      resolveUserMessagePresentation({
        role: "user",
        createdBy: "agent",
        creationSource: "server",
        text,
      }),
    ).toMatchObject({ attribution: "supaterm" });
    for (const creationSource of ["mcp", "provider"] as const) {
      expect(
        resolveUserMessagePresentation({ role: "user", createdBy: "agent", creationSource, text }),
      ).toMatchObject({ attribution: "agent" });
    }
  });
});
