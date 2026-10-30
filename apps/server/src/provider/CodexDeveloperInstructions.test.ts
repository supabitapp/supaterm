import * as NodeAssert from "node:assert/strict";

import {
  SUPATERM_ORCHESTRATION_INSTRUCTIONS,
  SUPATERM_ORCHESTRATION_SECTIONS,
} from "@supaterm/provider-core/server/orchestrationInstructions";
import { SUPATERM_DEVICE_TOOL_INSTRUCTIONS } from "@supaterm/provider-core/server/orchestrationInstructions";
import { describe, it } from "vite-plus/test";

import {
  buildCodexAdditionalContext,
  CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
} from "./CodexDeveloperInstructions.ts";

describe("buildCodexAdditionalContext", () => {
  describe.each([
    { model: "gpt-5.3-codex", reasoningEffort: "high" },
    { model: "custom-model", modelName: "Custom 🦊 Model", reasoningEffort: "xhigh" },
  ])("with runtime $model", (runtime) => {
    it.each([
      undefined,
      false,
      true,
      { browser: false, device: false },
      { browser: true, device: false },
      { browser: false, device: true },
      { browser: true, device: true },
    ])("keeps every entry within Codex's per-entry cap with tools %j", (availability) => {
      const context = buildCodexAdditionalContext(runtime, availability);

      for (const [key, entry] of Object.entries(context)) {
        const bytes = Buffer.byteLength(entry.value, "utf8");
        const limit = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES;
        NodeAssert.ok(
          bytes <= limit,
          `${key}: ${bytes} UTF-8 bytes exceeds Codex's ${limit}-byte per-entry cap by ${bytes - limit} bytes; split the instructions into separate entries to avoid silent truncation`,
        );
      }
    });
  });

  it("delivers all orchestration sections in authored order when keys are sorted", () => {
    const context = buildCodexAdditionalContext({
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    });
    const sections = Object.keys(context)
      .filter((key) => key.startsWith("supaterm_orchestration_"))
      .sort()
      .map((key) => context[key]!);

    NodeAssert.deepEqual(
      sections,
      SUPATERM_ORCHESTRATION_SECTIONS.map((value) => ({ kind: "application", value })),
    );
    NodeAssert.equal(
      sections.map((entry) => entry.value).join("\n\n"),
      SUPATERM_ORCHESTRATION_INSTRUCTIONS.trim(),
    );
  });
});

describe("Codex runtime context", () => {
  it("describes Markdown media support in the runtime context in both modes", () => {
    {
      const instructions = runtimeInstructions({
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
      });
      NodeAssert.match(
        instructions,
        /<runtime_info>.*embed images, video, and audio.*Markdown image syntax with absolute file paths.*Link any other file.*absolute path.*files viewer.*<\/runtime_info>/,
      );
    }
  });

  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = runtimeInstructions({
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("Codex orchestration context", () => {
  it("preserves model, options and isolation requirements for subagents", () => {
    const orchestration = Object.entries(buildCodexAdditionalContext({ model: "gpt-6.1-sol" }))
      .filter(([key]) => key.startsWith("supaterm_orchestration_"))
      .map(([, entry]) => entry.value)
      .join("\n");

    const requiredPolicies = [
      "Use native delegation for the same provider only when it supports the selected model and no options are requested or inherited.",
      "Otherwise use `delegate_task` with the selected provider instance and model.",
      "Use it also for cross-provider or explicitly Supaterm-owned child work.",
      'A separate checkout requires `delegate_task` with `isolation:"worktree"`.',
      "Every independent review or re-check needs a new `delegate_task`",
      "Ordinary same-conversation follow-ups may use `supaterm_thread_send` on `childThreadId`; independent review rounds may not.",
      "While an async delegate runs, end your turn and await its notification.",
      "Model options go in `target.options` after reading the selected model's descriptors.",
      "Nonempty inherited options for the same provider instance and model require `delegate_task` too.",
      "Never translate max to high or ignore unsupported settings: report the mismatch.",
      "Verify the returned providerInstanceId, model, and options.",
    ];
    for (const policy of requiredPolicies) {
      NodeAssert.ok(orchestration.includes(policy), policy);
    }

    NodeAssert.ok(!orchestration.includes("acp-mcp-call"));
  });
});

describe("Codex device context", () => {
  it("adds the shared device block only when the session holds device access", () => {
    const tools = (device: boolean) =>
      buildCodexAdditionalContext({ model: "gpt-6.1-sol" }, { browser: true, device })
        .supaterm_tools?.value ?? "";

    NodeAssert.ok(tools(true).includes(SUPATERM_DEVICE_TOOL_INSTRUCTIONS));
    NodeAssert.ok(!tools(true).includes("ToolSearch"));
    NodeAssert.ok(!tools(false).includes("## Supaterm devices"));
  });
});

function runtimeInstructions(runtime: Parameters<typeof buildCodexAdditionalContext>[0]) {
  return buildCodexAdditionalContext(runtime).supaterm_runtime!.value;
}
