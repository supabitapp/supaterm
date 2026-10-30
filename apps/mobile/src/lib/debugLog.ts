/**
 * Expected conditions, such as a queued send failing offline, log here so `console.warn` stays for
 * actionable failures; client-runtime bans `console.*`, so this cannot live there. Silent in every
 * build unless `globalThis.__SUPATERM_DEBUG__` is `true` or lists the namespace, or, in `__DEV__`,
 * the logger sets `enabledInDev`.
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
