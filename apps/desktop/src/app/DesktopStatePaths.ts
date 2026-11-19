import { resolveDefaultSupatermHome } from "@supaterm/shared/supatermHome";
import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(supatermHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(supatermHome)) {
    return Option.none();
  }
  const trimmed = supatermHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly supatermHome: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.supatermHome), () =>
    resolveDefaultSupatermHome(input.homeDirectory, input.joinPath),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly supatermHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.supatermHome));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
