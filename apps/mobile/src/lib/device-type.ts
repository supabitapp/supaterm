import type { NativeLayoutMetrics } from "./reserved-regions";

export type DeviceType = "phone" | "duo-folded" | "duo-unfolded" | "pad";

export function deriveDeviceType(input: {
  readonly isPad: boolean;
  readonly metrics: NativeLayoutMetrics | null;
}): DeviceType {
  if (input.isPad) return "pad";

  if (input.metrics?.hasHinge !== true) return "phone";
  return input.metrics.horizontalSizeClass === "regular" ? "duo-unfolded" : "duo-folded";
}

export function isDuoDevice(deviceType: DeviceType): boolean {
  return deviceType === "duo-folded" || deviceType === "duo-unfolded";
}
