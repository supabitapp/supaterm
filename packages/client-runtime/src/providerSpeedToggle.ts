import type { ProviderOptionDescriptor } from "@supaterm/contracts";
import { getProviderOptionCurrentValue } from "@supaterm/shared/model";

const STANDARD_SERVICE_TIER = "default";

export type SpeedToggleLevel = "off" | "fast" | "ultrafast";

export type SpeedToggle = {
  descriptorId: string;
  level: SpeedToggleLevel;
  onValue: string | boolean;
  offValue: string | boolean;
  ultrafastValue?: string | undefined;
  coversDescriptor: boolean;
};

export const SPEED_TOGGLE_LABELS: Readonly<Record<SpeedToggleLevel, string>> = {
  off: "Fast mode off",
  fast: "Fast mode on",
  ultrafast: "Ultrafast mode on",
};

export function getSpeedToggle(descriptors: ReadonlyArray<ProviderOptionDescriptor>) {
  for (const descriptor of descriptors) {
    if (descriptor.type === "boolean" && descriptor.id === "fastMode") {
      return {
        descriptorId: descriptor.id,
        level: descriptor.currentValue === true ? "fast" : "off",
        onValue: true,
        offValue: false,
        coversDescriptor: true,
      } satisfies SpeedToggle | null;
    }
    if (descriptor.type !== "select" || descriptor.id !== "serviceTier") {
      continue;
    }
    const fastTier = descriptor.options.find(({ label }) => label === "Fast");
    const ultrafastTier = descriptor.options.find(({ label }) => label === "Ultrafast");
    const onTier = fastTier ?? ultrafastTier;
    if (!onTier) {
      continue;
    }
    const currentValue = getProviderOptionCurrentValue(descriptor);
    let level: SpeedToggleLevel = "off";
    if (fastTier && currentValue === fastTier.id) level = "fast";
    if (ultrafastTier && currentValue === ultrafastTier.id) level = "ultrafast";
    return {
      descriptorId: descriptor.id,
      level,
      onValue: onTier.id,
      offValue: STANDARD_SERVICE_TIER,
      ultrafastValue: ultrafastTier?.id,
      coversDescriptor: descriptor.options.every(
        ({ id }) => id === STANDARD_SERVICE_TIER || id === onTier.id,
      ),
    } satisfies SpeedToggle | null;
  }
  return null satisfies SpeedToggle | null;
}

export function getSpeedToggleNextValue(toggle: SpeedToggle, preferUltrafast = false) {
  if (preferUltrafast && toggle.ultrafastValue !== undefined) return toggle.ultrafastValue;
  return toggle.level === "off" ? toggle.onValue : toggle.offValue;
}
