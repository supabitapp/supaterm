import type { ProviderOptionDescriptor } from "@supaterm/contracts";
import { getProviderOptionCurrentValue } from "@supaterm/shared/model";
import { msg } from "gt-i18n";

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
  off: msg("Fast mode off"),
  fast: msg("Fast mode on"),
  ultrafast: msg("Ultrafast mode on"),
};

export function getSpeedToggle(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): SpeedToggle | null {
  for (const descriptor of descriptors) {
    if (descriptor.type === "boolean" && descriptor.id === "fastMode") {
      return {
        descriptorId: descriptor.id,
        level: descriptor.currentValue === true ? "fast" : "off",
        onValue: true,
        offValue: false,
        coversDescriptor: true,
      };
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
        ({ id }) => id === STANDARD_SERVICE_TIER || id === fastTier?.id || id === ultrafastTier?.id,
      ),
    };
  }
  return null;
}

export function getSpeedToggleNextValue(toggle: SpeedToggle): string | boolean {
  return toggle.level === "off" ? toggle.onValue : toggle.offValue;
}

export type SpeedToggleChoice = {
  level: Exclude<SpeedToggleLevel, "off">;
  value: string | boolean;
  description: string | undefined;
};

export function getSpeedToggleChoices(
  toggle: SpeedToggle,
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<SpeedToggleChoice> | null {
  if (toggle.ultrafastValue === undefined || toggle.ultrafastValue === toggle.onValue) return null;
  const descriptor = descriptors.find(({ id }) => id === toggle.descriptorId);
  const describe = (value: string | boolean) =>
    descriptor?.type === "select"
      ? descriptor.options.find(({ id }) => id === value)?.description
      : undefined;
  return [
    { level: "fast", value: toggle.onValue, description: describe(toggle.onValue) },
    {
      level: "ultrafast",
      value: toggle.ultrafastValue,
      description: describe(toggle.ultrafastValue),
    },
  ];
}
