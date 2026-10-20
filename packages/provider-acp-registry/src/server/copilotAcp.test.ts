import { describe, expect, it } from "@effect/vitest";
import type * as AcpSchema from "effect-acp/compat";

import { makeCopilotSubagentRouting } from "./copilotAcp.ts";

const sessionId = "copilot-session";
const at = (update: AcpSchema.SessionNotification["update"]): AcpSchema.SessionNotification => ({
  sessionId,
  update,
});
const chunk = (text: string) =>
  at({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const taskComplete = (toolCallId: string, summary: string) => [
  at({
    sessionUpdate: "tool_call",
    toolCallId,
    title: "task_complete",
    kind: "other",
    status: "pending",
    rawInput: { summary },
  }),
  at({
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: summary } }],
    rawOutput: { content: summary, detailedContent: `✓ Task completed: ${summary}` },
  }),
];
const command = (toolCallId: string) =>
  at({ sessionUpdate: "tool_call", toolCallId, title: "ls", kind: "execute", status: "pending" });

describe("Copilot task_complete", () => {
  it("projects an autopilot summary as the final assistant message", () => {
    const { normalizeSessionUpdate } = makeCopilotSubagentRouting();
    const out = [
      chunk("Now run the tests."),
      command("bash-1"),
      ...taskComplete("done-1", "All four QA points are fixed."),
    ].map(normalizeSessionUpdate);
    expect(out[2]).toEqual(chunk("All four QA points are fixed."));
    expect(out[3]).toBeNull();
  });

  it("drops a summary that repeats the answer Copilot already streamed", () => {
    const { normalizeSessionUpdate } = makeCopilotSubagentRouting();
    const out = [chunk("hel"), chunk("lo"), ...taskComplete("done-1", "hello")].map(
      normalizeSessionUpdate,
    );
    expect(out.slice(2)).toEqual([null, null]);
  });

  it("separates a different summary from text still streaming", () => {
    const { normalizeSessionUpdate } = makeCopilotSubagentRouting();
    const out = [chunk("Checking."), ...taskComplete("done-1", "Done.")].map(
      normalizeSessionUpdate,
    );
    expect(out[1]).toEqual(chunk("\n\nDone."));
  });

  it("leaves other tools alone", () => {
    const { normalizeSessionUpdate } = makeCopilotSubagentRouting();
    expect(normalizeSessionUpdate(command("bash-1"))).toEqual(command("bash-1"));
  });
});
