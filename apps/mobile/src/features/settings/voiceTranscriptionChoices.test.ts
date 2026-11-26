import {
  ProviderInstanceId,
  type ManagedPolicySummary,
  type ServerProvider,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { voiceTranscriptionChoices } from "./voiceTranscriptionChoices";

const provider = (instanceId: string, driver: string) =>
  ({
    instanceId,
    driver,
    displayName: instanceId === "claudeAgent" ? "Claude" : "Codex",
    enabled: true,
    transcription: { status: "ready" },
  }) as unknown as ServerProvider;

const providers = [provider("claudeAgent", "claudeAgent"), provider("codex", "codex")];
const onlyCodex = {
  organization: "Example Corp",
  lockedSettings: [],
  limits: { providers: { allowedDrivers: ["codex"] } },
} as unknown as ManagedPolicySummary;

describe("voiceTranscriptionChoices", () => {
  it("keeps a chosen provider the policy disallows, with the organization's reason", () => {
    const { choices, automatic } = voiceTranscriptionChoices(
      providers,
      onlyCodex,
      ProviderInstanceId.make("claudeAgent"),
    );
    expect(choices.map(({ provider, denial }) => [provider.instanceId, denial])).toEqual([
      ["claudeAgent", "Example Corp's policy does not allow the Claude provider."],
      ["codex", undefined],
    ]);
    expect(automatic?.instanceId).toBe("codex");
  });

  it("leaves out disallowed providers nobody chose", () => {
    const { choices } = voiceTranscriptionChoices(providers, onlyCodex, null);
    expect(choices.map(({ provider }) => provider.instanceId)).toEqual(["codex"]);
  });
});
