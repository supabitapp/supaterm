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

const { providerInstanceId: _deviceHasNoInstance, ...deviceSource } = source("system:device");

const resolveId = (input: Parameters<typeof resolveDictationSource>[0]) =>
  resolveDictationSource(input)?.id ?? null;

const automatic = { enabled: true, source: null };
const chosen = (id: string) => ({ enabled: true, source: DictationSourceId.make(id) });

describe("resolveDictationSource", () => {
  it("resolves nothing when dictation is off", () => {
    expect(
      resolveId({
        sources: [source("codex:work")],
        settings: { enabled: false, source: DictationSourceId.make("codex:work") },
        threadInstanceId: ProviderInstanceId.make("work"),
      }),
    ).toBeNull();
  });

  it("picks the first eligible source by id for Automatic, whatever the input order", () => {
    expect(
      resolveId({
        sources: [
          source("codex:zeta"),
          source("codex:alpha", { eligible: false }),
          source("codex:mid"),
        ],
        settings: automatic,
      }),
    ).toBe("codex:mid");
  });

  it("prefers the thread's own instance when it can transcribe", () => {
    const sources = [source("codex:alpha"), source("codex:work")];
    expect(
      resolveId({
        sources,
        settings: automatic,
        threadInstanceId: ProviderInstanceId.make("work"),
      }),
    ).toBe("codex:work");
    expect(
      resolveId({
        sources,
        settings: chosen("codex:alpha"),
        threadInstanceId: ProviderInstanceId.make("work"),
      }),
    ).toBe("codex:work");
  });

  it("skips the thread's instance when it is ineligible or of another kind than the choice", () => {
    expect(
      resolveId({
        sources: [source("codex:alpha"), source("codex:work", { eligible: false })],
        settings: automatic,
        threadInstanceId: ProviderInstanceId.make("work"),
      }),
    ).toBe("codex:alpha");
    expect(
      resolveId({
        sources: [source("codex:work"), deviceSource],
        settings: chosen("system:device"),
        threadInstanceId: ProviderInstanceId.make("work"),
      }),
    ).toBe("system:device");
  });

  it("uses the chosen source when it is eligible", () => {
    expect(
      resolveId({
        sources: [source("codex:alpha"), source("codex:work")],
        settings: chosen("codex:work"),
      }),
    ).toBe("codex:work");
  });

  it("falls back to an eligible source of the chosen kind, then to Automatic", () => {
    expect(
      resolveId({
        sources: [
          source("antigravity:other"),
          source("codex:work", { eligible: false }),
          source("codex:zeta"),
        ],
        settings: chosen("codex:work"),
      }),
    ).toBe("codex:zeta");
    expect(
      resolveId({
        sources: [source("antigravity:other"), source("codex:work", { eligible: false })],
        settings: chosen("codex:work"),
      }),
    ).toBe("antigravity:other");
    expect(resolveId({ sources: [source("codex:alpha")], settings: chosen("codex:removed") })).toBe(
      "codex:alpha",
    );
  });

  it("resolves nothing when no source is eligible", () => {
    expect(
      resolveId({
        sources: [source("codex:work", { eligible: false })],
        settings: automatic,
        threadInstanceId: ProviderInstanceId.make("work"),
      }),
    ).toBeNull();
  });
});

describe("DictationSettings", () => {
  const decode = Schema.decodeUnknownSync(ServerSettings);

  it("defaults to enabled with Automatic", () => {
    expect(DEFAULT_SERVER_SETTINGS.dictation).toEqual({ enabled: true, source: null });
  });

  it("reads an unreadable source as Automatic instead of failing the settings", () => {
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
