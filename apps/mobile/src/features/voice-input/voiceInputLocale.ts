export function voiceInputLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}
