import type { EnvironmentThreadStatus } from "@supaterm/client-runtime/state/threads";
import { msg } from "gt-react";

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

export function threadSyncLabel(phase: ThreadSyncPhase): string {
  switch (phase) {
    case "loading":
      return msg("Loading messages...");
    case "syncing":
      return msg("Syncing messages...");
    case "failed":
      return msg("Could not sync messages");
  }
}
