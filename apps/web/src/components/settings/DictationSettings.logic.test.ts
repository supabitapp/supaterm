import {
  DictationSourceId,
  ProviderInstanceId,
  type DictationSourceDescriptor,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveDictationSettingsView } from "./DictationSettings.logic";

function source(
  instance: string,
  overrides: Partial<DictationSourceDescriptor> = {},
): DictationSourceDescriptor {
  return {
    id: DictationSourceId.make(`codex:${instance}`),
    kind: "codex",
    runsOn: "environment",
    label: `Codex ${instance}`,
    serviceLabel: "ChatGPT",
    accountLabel: `${instance}@example.com`,
    providerInstanceId: ProviderInstanceId.make(instance),
    eligible: true,
    audioFormats: ["webm"],
    ...overrides,
  };
}

function offered(
  sources: ReadonlyArray<DictationSourceDescriptor>,
  settings: { enabled?: boolean; source?: string | null } = {},
) {
  return resolveDictationSettingsView({
    status: "offered",
    offer: {
      capability: { maxClipBytes: 1024, maxDurationMs: 1000 },
      sources,
      settings: {
        enabled: settings.enabled ?? true,
        source:
          settings.source === undefined || settings.source === null
            ? null
            : DictationSourceId.make(settings.source),
      },
    },
  });
}

describe("resolveDictationSettingsView", () => {
  it("explains why an environment offers no dictation", () => {
    expect(resolveDictationSettingsView({ status: "unknown" })).toEqual({
      kind: "blocked",
      message: "Connect this environment to check dictation availability.",
    });
    expect(resolveDictationSettingsView({ status: "unsupported" })).toEqual({
      kind: "blocked",
      message: "Update this environment to use dictation.",
    });
    expect(resolveDictationSettingsView({ status: "forbidden" })).toEqual({
      kind: "blocked",
      message: "This connection can't use dictation.",
    });
  });

  it("asks for an account until one is chosen", () => {
    expect(offered([source("work")])).toMatchObject({
      kind: "offered",
      saved: null,
      hasEligibleSource: true,
      status: null,
      sourceNote: "Choose the account that transcribes voice input here.",
    });
  });

  it("names the chosen account in use", () => {
    expect(offered([source("work"), source("home")], { source: "codex:home" })).toMatchObject({
      saved: { id: "codex:home" },
      status: "Transcribed with ChatGPT · home@example.com",
      sourceNote: null,
    });
  });

  it("explains that a chosen account can't transcribe instead of using another one", () => {
    expect(
      offered(
        [source("work"), source("home", { eligible: false, unavailableReason: "Signed out." })],
        { source: "codex:home" },
      ),
    ).toMatchObject({
      status: null,
      sourceNote: "Codex home · home@example.com can't transcribe right now: Signed out.",
    });
    expect(offered([source("work")], { source: "codex:removed" })).toMatchObject({
      saved: null,
      sourceNote: "The chosen account can't transcribe right now.",
    });
  });

  it("reports when no account can transcribe", () => {
    expect(offered([source("work", { eligible: false })])).toMatchObject({
      hasEligibleSource: false,
      sourceNote: null,
    });
  });

  it("drops the status and note while dictation is off", () => {
    expect(offered([source("work")], { enabled: false, source: "codex:work" })).toMatchObject({
      status: null,
      sourceNote: null,
    });
  });
});
