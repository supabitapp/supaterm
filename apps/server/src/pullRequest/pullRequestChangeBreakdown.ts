import type { PullRequestChangeBreakdown } from "@supaterm/contracts";
import { summarizeChangedFiles } from "@supaterm/shared/changedFileKind";
import type { ProviderFileStats } from "@supaterm/source-control-core/server/PullRequestProvider";

export function toChangeBreakdown(stats: ProviderFileStats): PullRequestChangeBreakdown {
  if (stats.truncated) return null;
  return summarizeChangedFiles(stats.files);
}
