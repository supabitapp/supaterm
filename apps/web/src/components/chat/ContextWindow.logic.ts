import type { ProviderDriverKind, ProviderInstanceId } from "@supaterm/contracts";
import {
  resolveSelectableProviderInstanceEntry,
  type ProviderInstanceEntry,
} from "../../providerInstances";

export function usageFillColor(usedPercent: number): string {
  return usedPercent > 90
    ? "var(--color-error)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";
}

export function providerSupportsManualCompaction(
  provider: ProviderInstanceEntry | null | undefined,
): boolean {
  return provider?.snapshot.slashCommands.some((command) => command.name === "compact") ?? false;
}

export function hasAvailableCompactionProvider(input: {
  readonly providers: ReadonlyArray<ProviderInstanceEntry>;
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId | null;
  readonly lockedInstanceId: ProviderInstanceId | null;
}): boolean {
  const driverProviders = input.providers.filter(
    (provider) => provider.driverKind === input.driverKind,
  );
  const lockedContinuationGroupKey = input.lockedInstanceId
    ? driverProviders.find((provider) => provider.instanceId === input.lockedInstanceId)
        ?.continuationGroupKey
    : undefined;
  const compatibleProviders = lockedContinuationGroupKey
    ? driverProviders.filter(
        (provider) => provider.continuationGroupKey === lockedContinuationGroupKey,
      )
    : driverProviders;

  return providerSupportsManualCompaction(
    resolveSelectableProviderInstanceEntry(compatibleProviders, input.instanceId ?? undefined),
  );
}

export function formatContextWindowCompactionMessage(
  modelDisplayName: string | null | undefined,
  autoCompactThreshold?: number | null,
): string {
  if (typeof autoCompactThreshold === "number" && autoCompactThreshold > 0) {
    return `Compacts automatically at about ${autoCompactThreshold.toLocaleString("en-US")} tokens.`;
  }
  return modelDisplayName
    ? `Context for ${modelDisplayName} compacts automatically when needed.`
    : "Context compacts automatically when needed.";
}

export function formatContextWindowCost(cost: {
  readonly amount: number;
  readonly currency: string;
}): string {
  const fractionDigits = Math.abs(cost.amount) > 0 && Math.abs(cost.amount) < 0.01 ? 4 : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cost.currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(cost.amount);
  } catch {
    return `${cost.currency} ${cost.amount.toFixed(fractionDigits)}`;
  }
}
