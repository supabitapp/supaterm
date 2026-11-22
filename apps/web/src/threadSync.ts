import type { EnvironmentThreadStatus } from "@supaterm/client-runtime/state/threads";

export type ThreadSyncPhase = "loading" | "syncing" | "failed";

export function resolveThreadSyncPhase(input: {
  readonly detailExists: boolean;
  readonly shellExists: boolean;
  readonly status: EnvironmentThreadStatus;
  readonly hasError: boolean;
}): ThreadSyncPhase | null {
  if (!input.shellExists) {
    return null;
  }

  switch (input.status) {
    case "empty":
    case "cached":
    case "synchronizing":
      if (!input.detailExists) return "loading";
      return input.hasError ? "failed" : "syncing";
    case "deleted":
    case "live":
      return null;
  }
}
