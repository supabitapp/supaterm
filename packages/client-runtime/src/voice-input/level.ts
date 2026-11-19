const SILENT_DECIBELS = -55;
const FULL_DECIBELS = -10;

/** Linear in decibels, so quiet speech still moves the meter and normal speech fills most of it. */
export function voiceLevelFromDecibels(decibels: number | undefined): number {
  if (decibels === undefined || !Number.isFinite(decibels)) return 0;
  const level = (decibels - SILENT_DECIBELS) / (FULL_DECIBELS - SILENT_DECIBELS);
  return Math.min(1, Math.max(0, level));
}
