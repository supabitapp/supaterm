/** Offered in Settings. Each name is written in its own language. */
export const VOICE_LANGUAGES: ReadonlyArray<{ readonly code: string; readonly name: string }> = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "nl", name: "Nederlands" },
  { code: "da", name: "Dansk" },
  { code: "sv", name: "Svenska" },
  { code: "no", name: "Norsk" },
  { code: "pl", name: "Polski" },
  { code: "cs", name: "Čeština" },
  { code: "tr", name: "Türkçe" },
  { code: "el", name: "Ελληνικά" },
  { code: "ru", name: "Русский" },
  { code: "uk", name: "Українська" },
  { code: "hi", name: "हिन्दी" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh", name: "中文" },
];

const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;

/** BCP 47 from a platform locale such as `en_US` or `en-US-u-ca-gregory`, or null. */
export function normalizeVoiceLanguage(locale: string | null | undefined): string | null {
  const tag = locale
    ?.trim()
    .split("@")[0]
    ?.replaceAll("_", "-")
    .replace(/-u-.*$/i, "");
  if (!tag || !LANGUAGE_TAG.test(tag) || tag.split("-")[0]?.toLowerCase() === "und") return null;
  if (typeof Intl.getCanonicalLocales !== "function") return tag;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

export function systemVoiceLanguage(): string {
  return normalizeVoiceLanguage(Intl.DateTimeFormat().resolvedOptions().locale) ?? "en";
}

/** The chosen language, or the system's when none is chosen. */
export function resolveVoiceLanguage(
  preference: string | null | undefined,
  systemLanguage: string,
): string {
  return normalizeVoiceLanguage(preference) ?? systemLanguage;
}

export function voiceLanguageName(tag: string): string {
  const primary = tag.split("-")[0]?.toLowerCase();
  const code = primary === "nb" || primary === "nn" ? "no" : primary;
  return VOICE_LANGUAGES.find((language) => language.code === code)?.name ?? tag;
}
