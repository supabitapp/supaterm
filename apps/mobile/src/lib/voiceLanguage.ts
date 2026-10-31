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
