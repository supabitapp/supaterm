import { ProviderDriverKind, ProviderInstanceId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isMentionableProvider,
  matchComposerModelItems,
  type ComposerModelCandidate,
} from "./composerModelMentions.ts";

function candidate(
  instanceId: string,
  driver: string,
  providerName: string,
  model: string,
  name: string,
  subProvider?: string,
): ComposerModelCandidate {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    providerName,
    model,
    name,
    ...(subProvider ? { subProvider } : {}),
  };
}

const candidates = [
  candidate("codex", "codex", "Codex", "gpt-5.4", "GPT-5.4"),
  candidate("claudeAgent", "claudeAgent", "Claude", "claude-opus-4-5", "Claude Opus 4.5"),
  candidate("opencode", "opencode", "OpenCode", "openai/gpt-5.4", "GPT-5.4", "OpenAI"),
  candidate("opencode", "opencode", "OpenCode", "anthropic/claude-opus-4-5", "Opus", "Anthropic"),
];

function match(query: string): string[] {
  return matchComposerModelItems(candidates, query).map((item) => item.id);
}

describe("matchComposerModelItems", () => {
  it.each(["", "-", "---", ":/-/:"])("names no model for @%s", (query) => {
    expect(match(query)).toEqual([]);
  });

  it("finds a model under every provider that serves it", () => {
    expect(match("gpt").toSorted()).toEqual([
      "model:codex:gpt-5.4",
      "model:opencode:openai/gpt-5.4",
    ]);
  });

  it("splits words a mention joins with :, / or -", () => {
    expect(match("opencode:opus")).toEqual(["model:opencode:anthropic/claude-opus-4-5"]);
    expect(match("claude/opus")).toEqual(["model:claudeAgent:claude-opus-4-5"]);
    expect(match("anthropic-opus")).toEqual(["model:opencode:anthropic/claude-opus-4-5"]);
  });

  it("keeps a hyphenated model name whole when it matches", () => {
    expect(match("gpt-5.4").toSorted()).toEqual([
      "model:codex:gpt-5.4",
      "model:opencode:openai/gpt-5.4",
    ]);
  });

  it("does not fuzzy-match words that only resemble a model", () => {
    expect(match("src")).toEqual([]);
  });

  it("names the provider instance and model in the chip it inserts", () => {
    const [item] = matchComposerModelItems(candidates, "opencode:opus");
    expect(item).toMatchObject({
      label: "Opus",
      description: "OpenCode · Anthropic",
      record: {
        kind: "model",
        label: "Opus",
        instanceId: "opencode",
        driver: "opencode",
        model: "anthropic/claude-opus-4-5",
        providerName: "OpenCode",
      },
    });
  });
});

describe("isMentionableProvider", () => {
  const ready = {
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    availability: "available",
  } as const;

  it.each([
    ["ready", ready, true, true],
    ["warning", { ...ready, status: "warning" }, true, true],
    ["turned off", ready, false, false],
    ["signed out", { ...ready, auth: { status: "unauthenticated" } }, true, false],
    ["unavailable", { ...ready, availability: "unavailable" }, true, false],
    ["not installed", { ...ready, installed: false }, true, false],
    ["erroring", { ...ready, status: "error" }, true, false],
  ] as const)("a %s provider is mentionable: %s", (_state, provider, enabled, expected) => {
    expect(isMentionableProvider(provider, enabled)).toBe(expected);
  });
});
