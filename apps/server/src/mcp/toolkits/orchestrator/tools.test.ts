import { assert, describe, it } from "@effect/vitest";
import { Tool } from "effect/ai";

import { OrchestratorToolkit } from "./tools.ts";

describe("orchestrator MCP tool guidance", () => {
  // Oversized page sizes clamp on decode, so the schema has no `maximum`; Codex also drops
  // bounds from its TypeScript view. The description is the only place a model sees a limit.
  it("states supaterm_thread_read page size limits in the parameter descriptions", () => {
    const schema = Tool.getJsonSchema(OrchestratorToolkit.tools.supaterm_thread_read) as {
      readonly properties: Readonly<Record<string, { readonly description?: string }>>;
    };
    const limits = { limit: "100", runLimit: "50", maxCharsPerItem: "50000" };
    for (const [name, maximum] of Object.entries(limits)) {
      assert.include(schema.properties[name]?.description ?? "", maximum, name);
    }
  });
});
