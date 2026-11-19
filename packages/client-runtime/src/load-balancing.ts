import type { HostResourcesSnapshot } from "@supaterm/contracts";

/** Callers supply only connected machines hosting the project and selected provider. */
export function chooseLoadBalancedEnvironment(
  candidates: ReadonlyArray<{
    environmentId: string;
    resources: HostResourcesSnapshot | null;
    /** Client receipt time avoids comparing clocks on different machines. */
    receivedAt?: number;
    weight: number;
  }>,
  now: number,
): string | null {
  let selected: string | null = null;
  let bestRank = -1;
  let bestScore = 0;
  let bestWeight = 0;
  for (const { environmentId, resources, receivedAt, weight } of candidates) {
    if (!Number.isFinite(weight) || weight <= 0) continue;

    const sampledAt = receivedAt ?? resources?.sampledAt ?? 0;
    let rank = 0;
    let score = 0;
    if (
      resources &&
      now - sampledAt <= 15_000 &&
      sampledAt <= now + 5_000 &&
      resources.cpuUtilization !== null &&
      resources.totalMemoryBytes > 0 &&
      resources.cpuCount > 0
    ) {
      const memoryAvailable = resources.availableMemoryBytes / resources.totalMemoryBytes;
      rank = resources.cpuUtilization < 0.95 && memoryAvailable > 0.05 ? 2 : 1;
      score = weight * resources.cpuCount * (1 - resources.cpuUtilization) * memoryAvailable;
    }
    if (rank < bestRank) continue;
    if (rank === bestRank && (score < bestScore || (score === bestScore && weight <= bestWeight)))
      continue;

    selected = environmentId;
    bestRank = rank;
    bestScore = score;
    bestWeight = weight;
  }
  return selected;
}
