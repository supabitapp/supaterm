import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  formatContextWindowCompactionMessage,
  hasAvailableCompactionProvider,
  formatContextWindowCost,
} from "./ContextWindow.logic";

function claudeProvider(input: {
  instanceId: string;
  continuationGroupKey: string;
  enabled?: boolean;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make("claudeAgent"),
    continuation: { groupKey: input.continuationGroupKey },
    enabled: input.enabled ?? true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-24T12:00:00.000Z",
    models: [],
    slashCommands: [{ name: "compact", description: "" }],
    skills: [],
  };
}

describe("hasAvailableCompactionProvider", () => {
  const originalInstanceId = ProviderInstanceId.make("claude_original");

  it("rejects a fallback in a different locked continuation group", () => {
    const providers = deriveProviderInstanceEntries([
      claudeProvider({
        instanceId: originalInstanceId,
        continuationGroupKey: "claude:home:/original",
        enabled: false,
      }),
      claudeProvider({
        instanceId: "claude_other",
        continuationGroupKey: "claude:home:/other",
      }),
    ]);

    expect(
      hasAvailableCompactionProvider({
        providers,
        driverKind: ProviderDriverKind.make("claudeAgent"),
        instanceId: originalInstanceId,
        lockedInstanceId: originalInstanceId,
      }),
    ).toBe(false);
  });

  it("accepts an enabled fallback in the locked continuation group", () => {
    const providers = deriveProviderInstanceEntries([
      claudeProvider({
        instanceId: originalInstanceId,
        continuationGroupKey: "claude:home:/original",
        enabled: false,
      }),
      claudeProvider({
        instanceId: "claude_fallback",
        continuationGroupKey: "claude:home:/original",
      }),
    ]);

    expect(
      hasAvailableCompactionProvider({
        providers,
        driverKind: ProviderDriverKind.make("claudeAgent"),
        instanceId: originalInstanceId,
        lockedInstanceId: originalInstanceId,
      }),
    ).toBe(true);
  });
});

describe("formatContextWindowCompactionMessage", () => {
  it("describes compaction in terms of the selected model", () => {
    expect(formatContextWindowCompactionMessage("GPT-5.6 Sol")).toBe(
      "Context for GPT-5.6 Sol compacts automatically when needed.",
    );
  });

  it("uses neutral copy when the model is unavailable", () => {
    expect(formatContextWindowCompactionMessage(null)).toBe(
      "Context compacts automatically when needed.",
    );
  });

  it("shows the configured auto-compaction threshold", () => {
    expect(formatContextWindowCompactionMessage("Claude Sonnet 5", 300_000)).toBe(
      "Compacts automatically at about 300,000 tokens.",
    );
  });
});

describe("formatContextWindowCost", () => {
  it("keeps ordinary and sub-cent ACP costs readable", () => {
    expect(formatContextWindowCost({ amount: 0.42, currency: "USD" })).toBe("$0.42");
    expect(formatContextWindowCost({ amount: 0.0042, currency: "USD" })).toBe("$0.0042");
    expect(formatContextWindowCost({ amount: 0, currency: "USD" })).toBe("$0.00");
    expect(formatContextWindowCost({ amount: 1234.56, currency: "USD" })).toBe("$1,234.56");
  });

  it("preserves other currencies and provider-specific units", () => {
    expect(formatContextWindowCost({ amount: 0.42, currency: "EUR" })).toBe("€0.42");
    expect(formatContextWindowCost({ amount: 0.42, currency: "credits" })).toBe("credits 0.42");
  });
});
