const CLAUDE_VOICE_LANGUAGES = [
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
];

/** Whisper's languages under 50% word error rate; the server accepts any other ISO 639 code. */
const CODEX_VOICE_LANGUAGES = [
  ...CLAUDE_VOICE_LANGUAGES,
  "af",
  "ar",
  "hy",
  "az",
  "be",
  "bs",
  "bg",
  "ca",
  "zh",
  "hr",
  "et",
  "fi",
  "gl",
  "he",
  "hu",
  "is",
  "kn",
  "kk",
  "lv",
  "lt",
  "mk",
  "ms",
  "mr",
  "mi",
  "ne",
  "fa",
  "ro",
  "sr",
  "sk",
  "sl",
  "sw",
  "tl",
  "ta",
  "th",
  "ur",
  "vi",
  "cy",
];

/** Unknown drivers get Claude's list, which every transcription backend accepts. */
export function voiceLanguageOptions(driver: string | undefined): ReadonlyArray<string> {
  return driver === "codex" ? CODEX_VOICE_LANGUAGES : CLAUDE_VOICE_LANGUAGES;
}

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
