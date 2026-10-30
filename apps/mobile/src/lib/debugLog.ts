/**
 * Namespaced, filterable debug logging shared by mobile subsystems.
 *
 * Ordinary, expected conditions — a queued send failing while the device is
 * offline, for example — go through a debug logger instead of `console.warn`
 * so warning output stays reserved for failures someone can act on. Output
 * uses `console.log` with a `[supaterm-<namespace>]` prefix, matching the existing
 * terminal debug log. (client-runtime cannot host this: its
 * tooling bans `console.*` in favor of Effect logging.)
 *
 * A logger is silent in every build, including development, unless enabled.
 * Toggle it from a JS debugger or the Metro console, including on release/TestFlight builds:
 * - `globalThis.__SUPATERM_DEBUG__ = true` enables every namespace;
 * - `globalThis.__SUPATERM_DEBUG__ = ["thread-outbox"]` enables only listed ones.
 *
 * Subsystems whose traces are useful by default in development (`__DEV__`)
 * opt in with `enabledInDev`.
 */

export interface DebugLogger {
  readonly isEnabled: () => boolean;
  readonly log: (event: string, data?: Record<string, unknown>) => void;
}

export interface DebugLoggerOptions {
  readonly enabledInDev?: boolean;
}

function globalValue(name: string): unknown {
  return typeof globalThis === "undefined"
    ? undefined
    : (globalThis as Record<string, unknown>)[name];
}

export function createDebugLogger(
  namespace: string,
  options: DebugLoggerOptions = {},
): DebugLogger {
  const isEnabled = () => {
    if (options.enabledInDev === true && typeof __DEV__ !== "undefined" && __DEV__) {
      return true;
    }
    const filter = globalValue("__SUPATERM_DEBUG__");
    return filter === true || (Array.isArray(filter) && filter.includes(namespace));
  };
  const log = (event: string, data?: Record<string, unknown>) => {
    if (!isEnabled()) {
      return;
    }
    if (data === undefined) {
      console.log(`[supaterm-${namespace}] ${event}`);
    } else {
      console.log(`[supaterm-${namespace}] ${event}`, data);
    }
  };
  return { isEnabled, log };
}
