import { describe, expect, it } from "vite-plus/test";

import { normalizeVoiceLanguage } from "./voiceLanguage";

describe("normalizeVoiceLanguage", () => {
  it("turns platform locales into BCP 47 tags", () => {
    expect(normalizeVoiceLanguage("en_US")).toBe("en-US");
    expect(normalizeVoiceLanguage("pt-BR-u-ca-gregory")).toBe("pt-BR");
    expect(normalizeVoiceLanguage("zh-Hant-TW@calendar=chinese")).toBe("zh-Hant-TW");
    expect(normalizeVoiceLanguage("und")).toBeNull();
    expect(normalizeVoiceLanguage("")).toBeNull();
  });
});
