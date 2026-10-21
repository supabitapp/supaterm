import type { PullRequestChangeBreakdown } from "@supaterm/contracts";
import { classifyChangedFile } from "@supaterm/shared/changedFileKind";
import type { ProviderFileStats } from "@supaterm/source-control-core/server/PullRequestProvider";

export function toChangeBreakdown(stats: ProviderFileStats): PullRequestChangeBreakdown {
  if (stats.truncated) return null;
  const empty = () => ({ additions: 0, deletions: 0 });
  const breakdown = {
    code: empty(),
    tests: empty(),
    mocks: empty(),
    generated: empty(),
    docs: empty(),
  };
  for (const file of stats.files) {
    const bucket = breakdown[classifyChangedFile(file.path)];
    bucket.additions += file.additions;
    bucket.deletions += file.deletions;
  }
  return breakdown;
}
