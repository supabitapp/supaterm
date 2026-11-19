import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@supaterm/contracts";
import { collectProviderUsageLimits, hasProviderUsageLimits } from "@supaterm/shared/usageLimits";
import { useState } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { toastManager } from "../ui/toast";
import { usageLimitsBannerItem } from "./ComposerUsageLimits";

/**
 * Only the open moment is stored, so rows read live provider data. Anything that spends quota
 * closes the panel. `panelKey` is null while the provider list or thread is unavailable, such as
 * during a reconnect; the panel then stays hidden rather than being dropped.
 */
export function useUsageLimitsPanel(input: {
  readonly environmentId: EnvironmentId;
  readonly threadKey: string;
  readonly panelKey: string | null;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providerDriver: ServerProvider["driver"] | null;
  readonly providers: readonly ServerProvider[];
}) {
  const { environmentId, threadKey, panelKey, providerInstanceId, providerDriver, providers } =
    input;
  const [panel, setPanel] = useState<{
    readonly key: string;
    readonly threadKey: string;
    readonly now: number;
  } | null>(null);
  if (panel !== null && panelKey !== null && panel.key !== panelKey) {
    setPanel(null);
  }
  const report =
    panel !== null && panelKey !== null && panel.key === panelKey && providerInstanceId !== null
      ? collectProviderUsageLimits(providerInstanceId, providers, panel.now)
      : null;
  const banner =
    report !== null && panel !== null
      ? usageLimitsBannerItem(`usage-limits:${panel.key}:${panel.now}`, report, environmentId, () =>
          setPanel(null),
        )
      : null;
  const offered = providerDriver !== null && hasProviderUsageLimits(providerDriver, providers);

  const open = useStableCallback(() => {
    const now = Date.now();
    const nextReport =
      providerInstanceId !== null && panelKey !== null
        ? collectProviderUsageLimits(providerInstanceId, providers, now)
        : null;
    if (nextReport && panelKey !== null) {
      setPanel({ key: panelKey, threadKey, now });
      return true;
    }
    setPanel(null);
    toastManager.add({ type: "info", title: "Usage limits are unavailable for this provider" });
    return false;
  });
  const clearFor = useStableCallback((originThreadKey: string) =>
    setPanel((current) =>
      current !== null && current.threadKey === originThreadKey ? null : current,
    ),
  );

  return { banner, offered, open, clearFor };
}
