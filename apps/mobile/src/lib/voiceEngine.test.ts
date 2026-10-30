import { ProviderInstanceId, type ServerProvider } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveVoiceEngine } from "./voiceEngine";
import { normalizeVoiceLanguage, resolveVoiceLanguage } from "./voiceLanguage";

const CLAUDE = ProviderInstanceId.make("claudeAgent");

const serverConfig = (transcription: ServerProvider["transcription"]) => ({
  providers: [
    { instanceId: CLAUDE, displayName: "Claude", enabled: true, transcription } as ServerProvider,
  ],
  settings: { transcriptionProviderInstanceId: CLAUDE },
});

describe("resolveVoiceEngine", () => {
  it("transcribes on the environment unless this device was chosen", () => {
    expect(
      resolveVoiceEngine({
        preference: undefined,
        deviceName: "This iPhone",
        serverConfig: serverConfig({ status: "ready" }),
        language: "de-DE",
      }),
    ).toEqual({ status: "ready", engine: { kind: "environment", label: "Claude · Deutsch" } });
    expect(
      resolveVoiceEngine({
        preference: "device",
        deviceName: "This iPhone",
        serverConfig: serverConfig({ status: "ready" }),
        language: "de-DE",
      }),
    ).toEqual({ status: "ready", engine: { kind: "device", label: "This iPhone" } });
  });

  it("reports an environment that can't transcribe instead of switching to the device", () => {
    const signedOut = serverConfig({ status: "unavailable", reason: "signedOut" });
    expect(
      resolveVoiceEngine({
        preference: "environment",
        deviceName: "This iPhone",
        serverConfig: signedOut,
        language: "en",
      }),
    ).toEqual({
      status: "unavailable",
      message: "Sign in to this provider again to transcribe.",
      offersDevice: true,
    });
    expect(
      resolveVoiceEngine({
        preference: "environment",
        deviceName: null,
        serverConfig: signedOut,
        language: "en",
      }),
    ).toMatchObject({ status: "unavailable", offersDevice: false });
    expect(
      resolveVoiceEngine({
        preference: "device",
        deviceName: null,
        serverConfig: serverConfig({ status: "ready" }),
        language: "en",
      }),
    ).toMatchObject({ status: "unavailable", offersDevice: false });
  });

  it("records for an environment whose config hasn't arrived, so the turn can queue", () => {
    expect(
      resolveVoiceEngine({
        preference: undefined,
        deviceName: null,
        serverConfig: null,
        language: "en-US",
      }),
    ).toEqual({ status: "ready", engine: { kind: "environment", label: "English" } });
  });
});

describe("voice language", () => {
  it("follows the system until a language is chosen", () => {
    expect(resolveVoiceLanguage(undefined, "fr-CA")).toBe("fr-CA");
    expect(resolveVoiceLanguage(null, "fr-CA")).toBe("fr-CA");
    expect(resolveVoiceLanguage("ja", "fr-CA")).toBe("ja");
  });

  it("turns platform locales into BCP 47 tags", () => {
    expect(normalizeVoiceLanguage("en_US")).toBe("en-US");
    expect(normalizeVoiceLanguage("pt-BR-u-ca-gregory")).toBe("pt-BR");
    expect(normalizeVoiceLanguage("zh-Hant-TW@calendar=chinese")).toBe("zh-Hant-TW");
    expect(normalizeVoiceLanguage("und")).toBeNull();
    expect(normalizeVoiceLanguage("")).toBeNull();
  });
});
