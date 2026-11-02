import { describe, expect, it } from "vite-plus/test";

import {
  SUPATERM_MCP_TOOL_NAMES,
  resolveSupatermMcpSummaryAction,
  resolveSupatermMcpToolDefinition,
  resolveSupatermMcpToolPresentation,
} from "./supatermMcpToolPresentation.ts";

describe("resolveSupatermMcpToolPresentation", () => {
  it("recognizes every tool across provider prefixes and completion suffixes", () => {
    for (const tool of SUPATERM_MCP_TOOL_NAMES) {
      const presentation = resolveSupatermMcpToolPresentation(tool);
      expect(presentation, tool).not.toBeNull();
      for (const prefix of [
        "mcp__supaterm__",
        "mcp__Supaterm__",
        "supaterm.",
        "Supaterm.",
        "supaterm/",
        "supaterm:",
        "mcp_supaterm_",
        "supaterm ",
        "Supaterm ",
        "supaterm · ",
      ]) {
        expect(resolveSupatermMcpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveSupatermMcpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveSupatermMcpToolPresentation("supaterm-thread_opencode2-adapter_delegate_task")
        ?.displayName,
    ).toBe("Delegate a child task");
    expect(
      resolveSupatermMcpToolPresentation("supaterm-thread_opencode2-adapter_not_a_tool"),
    ).toBeNull();
  });
});

describe("resolveSupatermMcpToolDefinition", () => {
  it("labels an action tool call as the action it ran", () => {
    expect(
      resolveSupatermMcpToolDefinition("mcp__supaterm__preview_act", { action: "type" })?.labels,
    ).toEqual(resolveSupatermMcpToolDefinition("preview_type")?.labels);
    expect(
      resolveSupatermMcpToolDefinition("supaterm_thread_transfer", { action: "fork" })?.displayName,
    ).toBe(resolveSupatermMcpToolDefinition("supaterm_thread_fork")?.displayName);
    expect(resolveSupatermMcpToolDefinition("preview_act", { action: "unknown" })?.labels[2]).toBe(
      "Used",
    );
  });
});

describe("resolveSupatermMcpSummaryAction", () => {
  it("summarizes an action tool by the action each call ran", () => {
    expect(
      resolveSupatermMcpSummaryAction("mcp__supaterm__supaterm_queue", { action: "list" }),
    ).toBe("queue-list");
    expect(resolveSupatermMcpSummaryAction("supaterm_queue", { action: "edit" })).toBe(
      "queue-edit",
    );
    expect(resolveSupatermMcpSummaryAction("supaterm_thread_transfer", { action: "status" })).toBe(
      "thread-transfers",
    );
    expect(resolveSupatermMcpSummaryAction("supaterm_thread_configure", {})).toBe(
      "thread-configuration",
    );
    expect(resolveSupatermMcpSummaryAction("schedule_task", { scheduledTaskId: "task-1" })).toBe(
      "schedule-update",
    );
    expect(resolveSupatermMcpSummaryAction("delegate_task", { task: "x" })).toBe("delegate");
  });
});
