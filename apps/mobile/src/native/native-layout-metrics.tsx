import { createContext, use, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { deriveDeviceType, isDuoDevice, type DeviceType } from "../lib/device-type";
import type { NativeLayoutMetrics } from "../lib/reserved-regions";
import { NativeLayoutObserver } from "./NativeLayoutObserver";

const IS_PAD = Platform.OS === "ios" && Platform.isPad;

const NativeLayoutContext = createContext<NativeLayoutMetrics | null>(null);

const DeviceTypeContext = createContext<DeviceType>(
  deriveDeviceType({ isPad: IS_PAD, metrics: null }),
);

export const NATIVE_METRICS_TIMEOUT_MS = 1000;
const NativeLayoutMetricsDeadlineContext = createContext<number>(0);

export const NativeColumnLayoutMetricsContext = createContext<NativeLayoutMetrics | null>(null);

let latestMetrics: NativeLayoutMetrics | null = null;
const metricsWaiters = new Set<(metrics: NativeLayoutMetrics) => void>();

export function firstNativeLayoutMetrics(timeoutMs: number) {
  if (latestMetrics) return Promise.resolve(latestMetrics);
  return new Promise<NativeLayoutMetrics | null>((resolve) => {
    const settle = (metrics: NativeLayoutMetrics | null) => {
      metricsWaiters.delete(settle);
      clearTimeout(timeout);
      resolve(metrics);
    };
    const timeout = setTimeout(() => settle(null), timeoutMs);
    metricsWaiters.add(settle);
  });
}

export function currentNativeLayoutMetrics() {
  return latestMetrics;
}

export function NativeLayoutMetricsProvider(props: { readonly children: ReactNode }) {
  const [metrics, setMetrics] = useState<NativeLayoutMetrics | null>(null);
  const [metricsDeadline] = useState(() => Date.now() + NATIVE_METRICS_TIMEOUT_MS);
  const publish = (next: NativeLayoutMetrics) => {
    latestMetrics = next;
    for (const settle of metricsWaiters) settle(next);
    setMetrics(next);
  };
  const deviceType = deriveDeviceType({ isPad: IS_PAD, metrics });
  return (
    <NativeLayoutMetricsDeadlineContext value={metricsDeadline}>
      <NativeLayoutContext value={metrics}>
        <DeviceTypeContext value={deviceType}>
          <NativeLayoutObserver onChange={publish} />
          {props.children}
        </DeviceTypeContext>
      </NativeLayoutContext>
    </NativeLayoutMetricsDeadlineContext>
  );
}

export function useNativeLayoutMetrics() {
  return use(NativeLayoutContext);
}

export function useNativeLayoutMetricsDeadline() {
  return use(NativeLayoutMetricsDeadlineContext);
}

export function useNativeColumnLayoutMetrics() {
  return use(NativeColumnLayoutMetricsContext);
}

export function useDeviceType() {
  return use(DeviceTypeContext);
}

export function useDuoBottomBarInset() {
  const deviceType = useDeviceType();

  const inset = use(NativeColumnLayoutMetricsContext)?.bottomBarInset;
  return isDuoDevice(deviceType) && inset !== undefined && inset > 0 ? inset : undefined;
}
