import { describe, expect, it } from "vite-plus/test";

import {
  SUPATERM_MCP_TOOL_NAMES,
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
