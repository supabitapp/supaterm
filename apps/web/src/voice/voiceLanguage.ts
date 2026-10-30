/** The languages Claude transcribes; Codex accepts any tag, so others stay reachable via the system language. */
export const VOICE_LANGUAGE_OPTIONS = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "sv",
  "da",
  "no",
  "pl",
  "cs",
  "uk",
  "ru",
  "el",
  "tr",
  "hi",
  "id",
  "ja",
  "ko",
] as const;

export function voiceLanguageLabel(tag: string): string {
  try {
    return new Intl.DisplayNames([navigator.language], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function systemVoiceLanguage(): string {
  return navigator.language || "en";
}

export function resolveVoiceLanguage(setting: string | null) {
  const tag = setting ?? systemVoiceLanguage();
  return { tag, label: voiceLanguageLabel(tag) };
}
