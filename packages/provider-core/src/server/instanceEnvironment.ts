import type { ProviderInstanceEnvironment } from "@supaterm/contracts";
import { stripAppImageRuntimeEnv } from "@supaterm/shared/appImageRuntimeEnv";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";

import { expandHomeVariable } from "./pathExpansion.ts";

export const mergeProviderInstanceEnvironment = Effect.fn(function* (
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
) {
  // Commands the agent runs inherit this env; the AppImage mount's libraries would shadow the system's.
  const hostEnv = stripAppImageRuntimeEnv(baseEnv);
  if (!environment || environment.length === 0) {
    return hostEnv;
  }

  const home = yield* HostProcess.HomeDirectory;
  const next: NodeJS.ProcessEnv = { ...hostEnv };
  for (const variable of environment) {
    next[variable.name] = expandHomeVariable(variable.name, variable.value, home);
  }
  return next;
});
