// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

export function resolveDefaultSupatermHome(
  homeDirectory: string,
  joinPath: (first: string, ...segments: string[]) => string = NodePath.join,
): string {
  return joinPath(homeDirectory, ".supaterm");
}
