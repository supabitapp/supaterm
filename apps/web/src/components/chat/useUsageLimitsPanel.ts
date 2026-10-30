import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@supaterm/contracts";
import { collectProviderUsageLimits, hasProviderUsageLimits } from "@supaterm/shared/usageLimits";
import { useState } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { toastManager } from "../ui/toast";
import { usageLimitsBannerItem } from "./ComposerUsageLimits";

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
  // Drop the snapshot as soon as the thread or model changes so it cannot resurface stale.
  if (panel !== null && panelKey !== null && panel.key !== panelKey) {
    setPanel(null);
  }
  const report =
    panel !== null && panelKey !== null && panel.key === panelKey && providerInstanceId !== null
      ? collectProviderUsageLimits(providerInstanceId, providers, panel.now)
      : null;
  const banner =
    report !== null && panel !== null
      ? // A fresh id per opening: the stack keeps the last dismissed id as "exiting".
        usageLimitsBannerItem(`usage-limits:${panel.key}:${panel.now}`, report, environmentId, () =>
          setPanel(null),
        )
      : null;
  // Supaterm owns /usage-limits only where Limits has data for the selected provider;
  // elsewhere the name stays the provider's own and is sent through untouched.
  const offered = providerDriver !== null && hasProviderUsageLimits(providerDriver, providers);

  // Answered locally from the last Limits snapshot; the agent never sees it.
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
  // Responses can resolve after navigating away; only the originating thread's panel clears.
  const clearFor = useStableCallback((originThreadKey: string) =>
    setPanel((current) =>
      current !== null && current.threadKey === originThreadKey ? null : current,
    ),
  );

  return { banner, offered, open, clearFor };
}
