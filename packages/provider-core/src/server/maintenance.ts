import type { ProviderDriverKind } from "@supaterm/contracts";
import type * as Effect from "effect/Effect";

export interface ProviderMaintenanceCapabilities {
  readonly provider: ProviderDriverKind;
  readonly packageName: string | null;
  readonly update: ProviderMaintenanceCommandAction | null;

  readonly latestVersion?: string | null;
  readonly lookupLatestVersion?: Effect.Effect<string | null>;
  readonly compareVersions?: (current: string, latest: string) => number;
  readonly installPath?: string;
}

export interface ProviderMaintenanceCommandAction {
  readonly command: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly lockKey: string;

  readonly env?: NodeJS.ProcessEnv;
}
