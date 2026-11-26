import type { ProjectScript } from "@supaterm/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

/** @public */
export function projectScriptMenuLabel(
  script: ProjectScript,
  resolve: MFunctionType = mFallback,
): string {
  const name = script.name;
  if (script.runOnWorktreeCreate && script.runOnDone) {
    return resolve(msg("{name} (setup, on done)", { name }));
  }
  if (script.runOnWorktreeCreate) return resolve(msg("{name} (setup)", { name }));
  if (script.runOnDone) return resolve(msg("{name} (on done)", { name }));
  return name;
}
