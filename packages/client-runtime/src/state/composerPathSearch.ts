import type { EnvironmentId } from "@supaterm/contracts";

export interface ComposerPathSearchEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly parentPath?: string;
}

export interface ComposerPathSearchTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query: string | null;
}
