import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type ServerProviderModel } from "@supaterm/contracts";

import {
  deriveProviderModelsForDisplay,
  nextProviderEnvironmentWithFieldValue,
} from "./ProviderInstanceCard";

describe("deriveProviderModelsForDisplay", () => {
  it("does not restore unsupported Claude Fast from a saved custom definition", () => {
    const capabilities = {
      optionDescriptors: [{ id: "fastMode", label: "Fast Mode", type: "boolean" as const }],
    };
    const customModels = [{ slug: "custom", name: "Custom", capabilities }];
    const models = deriveProviderModelsForDisplay({
      driver: ProviderDriverKind.make("claudeAgent"),
      liveModels: [
        { ...customModels[0]!, isCustom: true, capabilities: { optionDescriptors: [] } },
      ],
      customModels,
    });
    expect(models[0]?.capabilities?.optionDescriptors).toEqual([]);
    expect(customModels[0]?.capabilities).toBe(capabilities);
  });
  it("uses current config custom models instead of stale live custom rows", () => {
    const liveModels: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "server-model",
        name: "Server Model",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "removed-custom",
        name: "Removed Custom",
        isCustom: true,
        capabilities: null,
      },
      {
        slug: "kept-custom",
        name: "Kept Custom",
        isCustom: true,
        capabilities: null,
      },
    ];

    expect(
      deriveProviderModelsForDisplay({
        driver: ProviderDriverKind.make("codex"),
        liveModels,
        customModels: [{ slug: "kept-custom", name: "kept-custom", capabilities: null }],
      }).map((model) => model.slug),
    ).toEqual(["server-model", "kept-custom"]);
  });

  it("prefers the entry's name and capabilities over the stale live custom row", () => {
    const liveCapabilities = { optionDescriptors: [] };
    const customCapabilities = {
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select" as const,
          options: [{ id: "high", label: "High", isDefault: true }],
          currentValue: "high",
        },
      ],
    };
    const liveModels: ReadonlyArray<ServerProviderModel> = [
      { slug: "bare", name: "bare", isCustom: true, capabilities: liveCapabilities },
      { slug: "named", name: "named", isCustom: true, capabilities: liveCapabilities },
    ];

    const display = deriveProviderModelsForDisplay({
      driver: ProviderDriverKind.make("codex"),
      liveModels,
      customModels: [
        { slug: "bare", name: "bare", capabilities: null },
        { slug: "named", name: "My Model", capabilities: customCapabilities },
      ],
    });

    expect(display[0]).toEqual({
      slug: "bare",
      name: "bare",
      isCustom: true,
      capabilities: liveCapabilities,
    });
    expect(display[1]).toEqual({
      slug: "named",
      name: "My Model",
      isCustom: true,
      capabilities: customCapabilities,
    });
  });
});

describe("provider environment helpers", () => {
  const cursorApiKeyField = {
    name: "CURSOR_API_KEY",
    label: "Cursor API key",
    sensitive: true,
  };

  it("writes dedicated provider secrets as sensitive environment variables", () => {
    expect(
      nextProviderEnvironmentWithFieldValue(
        [{ name: "EXTRA_FLAG", value: "1", sensitive: false }],
        cursorApiKeyField,
        "  cursor-key  ",
      ),
    ).toEqual([
      { name: "EXTRA_FLAG", value: "1", sensitive: false },
      { name: "CURSOR_API_KEY", value: "cursor-key", sensitive: true },
    ]);
  });

  it("replaces redacted provider secrets without preserving redaction markers", () => {
    expect(
      nextProviderEnvironmentWithFieldValue(
        [
          {
            name: "CURSOR_API_KEY",
            value: "",
            sensitive: true,
            valueRedacted: true,
          },
        ],
        cursorApiKeyField,
        "new-key",
      ),
    ).toEqual([{ name: "CURSOR_API_KEY", value: "new-key", sensitive: true }]);
  });

  it("applies the secure field default when replacing an existing non-sensitive value", () => {
    expect(
      nextProviderEnvironmentWithFieldValue(
        [{ name: "OPENAI_API_KEY", value: "old-key", sensitive: false }],
        {
          name: "OPENAI_API_KEY",
          label: "OpenAI API key",
        },
        "new-key",
      ),
    ).toEqual([{ name: "OPENAI_API_KEY", value: "new-key", sensitive: true }]);
  });
});
