import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { useDeadlinePassed } from "../lib/clock";
import type { NativeLayoutMetrics } from "../lib/reserved-regions";
import { useNativeLayoutMetrics, useNativeLayoutMetricsDeadline } from "./native-layout-metrics";

export { NATIVE_METRICS_TIMEOUT_MS } from "./native-layout-metrics";

const nativeControls = requireOptionalNativeModule<{
  readonly supportsWorkspaceColumns?: boolean;
  readonly ViewPrototypes?: { readonly SupatermNativeControls_LayoutMetrics?: unknown };
}>("SupatermNativeControls");
export const NATIVE_WORKSPACE_COLUMNS_SUPPORTED =
  Platform.OS === "ios" && Platform.isPad && nativeControls?.supportsWorkspaceColumns === true;

export function nativeWorkspaceColumnsSupportedFor(metrics: NativeLayoutMetrics | null) {
  return (
    NATIVE_WORKSPACE_COLUMNS_SUPPORTED ||
    (nativeControls?.supportsWorkspaceColumns === true && metrics?.hasHinge === true)
  );
}

export function useNativeWorkspaceColumnsReady() {
  const metrics = useNativeLayoutMetrics();
  const metricsDeadline = useNativeLayoutMetricsDeadline();
  const waiting =
    !(Platform.OS === "ios" && Platform.isPad) &&
    !!nativeControls?.ViewPrototypes?.SupatermNativeControls_LayoutMetrics &&
    metrics === null;

  const timedOut = useDeadlinePassed(waiting ? metricsDeadline : null);
  return !waiting || timedOut;
}

export function useNativeWorkspaceColumnsSupported() {
  return nativeWorkspaceColumnsSupportedFor(useNativeLayoutMetrics());
}
