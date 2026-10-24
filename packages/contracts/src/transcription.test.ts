import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";
import { DEFAULT_SERVER_SETTINGS, ServerSettings } from "./settings.ts";
import {
  DictationSourceId,
  type DictationSourceDescriptor,
  resolveDictationSource,
} from "./transcription.ts";

const source = (
  id: string,
  overrides: Partial<DictationSourceDescriptor> = {},
): DictationSourceDescriptor => {
  const [kind, ref] = id.split(":") as [string, string];
  return {
    id: DictationSourceId.make(id),
    kind,
    runsOn: "environment",
    label: ref,
    serviceLabel: "ChatGPT",
    accountLabel: null,
    providerInstanceId: ProviderInstanceId.make(ref),
    eligible: true,
    audioFormats: ["webm"],
    ...overrides,
  };
};

const resolveId = (input: Parameters<typeof resolveDictationSource>[0]) =>
  resolveDictationSource(input)?.id ?? null;

const chosen = (id: string) => ({ enabled: true, source: DictationSourceId.make(id) });

describe("resolveDictationSource", () => {
  it("resolves nothing when dictation is off", () => {
    expect(
      resolveId({
        sources: [source("codex:work")],
        settings: { enabled: false, source: DictationSourceId.make("codex:work") },
      }),
    ).toBeNull();
  });

  it("resolves nothing until a source is chosen, even when one is ready", () => {
    expect(
      resolveId({ sources: [source("codex:work")], settings: { enabled: true, source: null } }),
    ).toBeNull();
  });

  it("uses the chosen source when it is eligible", () => {
    expect(
      resolveId({
        sources: [source("codex:alpha"), source("codex:work")],
        settings: chosen("codex:work"),
      }),
    ).toBe("codex:work");
  });

  it("never falls back to another source when the chosen one can't transcribe", () => {
    expect(
      resolveId({
        sources: [source("codex:work", { eligible: false }), source("claude:work")],
        settings: chosen("codex:work"),
      }),
    ).toBeNull();
    expect(
      resolveId({ sources: [source("codex:alpha")], settings: chosen("codex:removed") }),
    ).toBeNull();
  });
});

describe("DictationSettings", () => {
  const decode = Schema.decodeUnknownSync(ServerSettings);

  it("defaults to enabled with no source chosen", () => {
    expect(DEFAULT_SERVER_SETTINGS.dictation).toEqual({ enabled: true, source: null });
  });

  it("reads an unreadable source as unchosen instead of failing the settings", () => {
    expect(decode({ dictation: { enabled: false, source: "not a source id" } }).dictation).toEqual({
      enabled: false,
      source: null,
    });
    expect(decode({ dictation: { source: "system:device" } }).dictation).toEqual({
      enabled: true,
      source: "system:device",
    });
  });
});
