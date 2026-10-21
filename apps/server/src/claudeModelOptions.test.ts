import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId, type ModelSelection } from "@supaterm/contracts";

import { compileClaudeModelSelection } from "./claudeModelOptions.ts";
import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  scopeClaudeModelCatalog,
} from "./provider/ClaudeModelCatalog.ts";

const selection = (
  model: string,
  options: NonNullable<ModelSelection["options"]>,
): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claude_test"),
  model,
  options,
});

describe("compileClaudeModelSelection", () => {
  it("does not borrow built-in Fast support for a custom model that shadows its alias", () => {
    const catalog = scopeClaudeModelCatalog(BUNDLED_CLAUDE_MODEL_CATALOG, [
      {
        slug: "opus",
        capabilities: { optionDescriptors: [{ id: "fastMode", label: "Fast", type: "boolean" }] },
      },
    ]);
    const custom = compileClaudeModelSelection(
      selection("opus", [{ id: "fastMode", value: true }]),
      catalog,
    );
    const builtin = compileClaudeModelSelection(
      selection("claude-opus-5-5", [{ id: "fastMode", value: true }]),
      catalog,
    );
    expect(custom.apiModelId).toBe("opus");
    expect(custom.settings.fastMode).toBe(false);
    expect(builtin.settings.fastMode).toBe(true);
  });
  it("suppresses custom Fast without changing the existing root model compilation", () => {
    const saved = selection("opus", [
      { id: "fastMode", value: true },
      { id: "effort", value: "max" },
    ]);
    const previous = compileClaudeModelSelection(saved);
    const custom = compileClaudeModelSelection(saved, undefined, { customModels: ["opus"] });
    expect(custom).toMatchObject({
      apiModelId: previous.apiModelId,
      effort: previous.effort,
      promptEffort: previous.promptEffort,
      settings: { ...previous.settings, fastMode: false },
    });
  });
  it("forces saved Fast off while blocked and changes the live query identity on recovery", () => {
    const saved = selection("claude-opus-5-5", [{ id: "fastMode", value: true }]);
    const blocked = compileClaudeModelSelection(saved, undefined, { fastModeBlocked: true });
    const recovered = compileClaudeModelSelection(saved);
    expect(blocked.settings.fastMode).toBe(false);
    expect(recovered.settings.fastMode).toBe(true);
    expect(blocked.queryIdentity).not.toBe(recovered.queryIdentity);
    expect(saved.options).toEqual([{ id: "fastMode", value: true }]);
  });

  it.each(["claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5", "custom"])(
    "sends Fast off for unsupported model %s",
    (model) => {
      expect(
        compileClaudeModelSelection(selection(model, [{ id: "fastMode", value: true }])).settings
          .fastMode,
      ).toBe(false);
    },
  );
  it("compiles context, effort, and settings together", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-opus-4-6", [
          { id: "contextWindow", value: "1m" },
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ]),
      ),
    ).toMatchObject({
      apiModelId: "claude-opus-4-6[1m]",
      effort: "max",
      settings: { fastMode: false },
    });
  });

  it("compiles fast mode only for models that expose it", () => {
    expect(
      compileClaudeModelSelection(selection("claude-opus-4-8", [{ id: "fastMode", value: true }]))
        .settings,
    ).toEqual({ fastMode: true });
    expect(
      compileClaudeModelSelection(selection("claude-opus-4-8", [{ id: "fastMode", value: false }]))
        .settings,
    ).toEqual({ fastMode: false });
  });

  it("uses the model default SDK effort alongside prompt-injected effort", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-sonnet-4-6", [{ id: "effort", value: "ultrathink" }]),
      ),
    ).toMatchObject({ effort: "high", promptEffort: "ultrathink" });
  });

  it("keeps explicit effort for models missing from the local catalog", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-pool-model-not-in-catalog", [{ id: "effort", value: "max" }]),
      ).effort,
    ).toBe("max");
    expect(
      compileClaudeModelSelection(selection("claude-pool-model-not-in-catalog", [])).effort,
    ).toBeUndefined();
  });

  it("omits unsupported effort for models missing from the local catalog", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-pool-model-not-in-catalog", [{ id: "effort", value: "brutal" }]),
      ).effort,
    ).toBeUndefined();
  });

  it("compiles the thinking toggle for models that expose it", () => {
    expect(
      compileClaudeModelSelection(selection("claude-haiku-4-5", [{ id: "thinking", value: false }]))
        .settings,
    ).toEqual({ alwaysThinkingEnabled: false, fastMode: false });
  });
});
