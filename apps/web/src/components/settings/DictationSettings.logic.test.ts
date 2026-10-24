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

  it("names what Automatic resolves to and the source in use", () => {
    expect(offered([source("work"), source("home")])).toMatchObject({
      kind: "offered",
      automaticDescription: "Uses Codex home · home@example.com",
      hasEligibleSource: true,
      status: "Transcribed with ChatGPT · home@example.com",
      sourceNote: null,
    });
  });

  it("falls back from an ineligible saved source and says so", () => {
    const view = offered(
      [
        source("managed", { eligible: false, accountLabel: null, unavailableReason: "No." }),
        source("work"),
      ],
      { source: "codex:managed" },
    );
    expect(view).toMatchObject({
      saved: { label: "Codex managed" },
      status: "Transcribed with ChatGPT · work@example.com",
      sourceNote:
        "Codex managed is unavailable. Dictation uses Codex work · work@example.com instead.",
    });
  });

  it("describes a saved source the environment no longer lists", () => {
    expect(offered([source("work")], { source: "codex:gone" })).toMatchObject({
      saved: null,
      sourceNote:
        "The selected transcription model is unavailable. Dictation uses Codex work · work@example.com instead.",
    });
  });

  it("reports no eligible source without a fallback note", () => {
    expect(
      offered([source("managed", { eligible: false })], { source: "codex:managed" }),
    ).toMatchObject({
      automaticDescription: "No transcription model is available.",
      hasEligibleSource: false,
      status: null,
      sourceNote: null,
    });
    expect(offered([])).toMatchObject({ hasEligibleSource: false, status: null });
  });

  it("keeps the preview but drops the status while dictation is off", () => {
    expect(offered([source("work")], { enabled: false, source: "codex:gone" })).toMatchObject({
      automaticDescription: "Uses Codex work · work@example.com",
      hasEligibleSource: true,
      status: null,
      sourceNote: null,
    });
  });
});
