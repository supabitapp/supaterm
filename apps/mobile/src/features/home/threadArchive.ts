import {
  threadRuntimeCanArchive,
  type ThreadRuntimeSummary,
} from "@supaterm/client-runtime/state/models";

export function threadCanArchive(runtime: ThreadRuntimeSummary | null | undefined): boolean {
  return threadRuntimeCanArchive(runtime);
}
