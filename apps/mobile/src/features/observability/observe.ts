import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";

import { crashReportingEndpoint } from "../../lib/crashReportingConfig";

const nativeObserve = requireOptionalNativeModule<{
  configure(options: { dispatchingEnabled: boolean }): void;
}>("ExpoObserve");
const endpoint = crashReportingEndpoint(Constants.expoConfig?.extra?.crashReporting?.endpointUrl);
export const crashReportingAvailable = endpoint !== null && nativeObserve !== null;

let observe: typeof import("expo-observe").Observe | undefined;
let loading: Promise<typeof import("expo-observe").Observe> | undefined;
let active = false;
let revision = 0;

function loadObserve() {
  loading ??= import("expo-observe").then((module) => {
    observe = module.Observe;
    return module.Observe;
  });
  return loading;
}

function configure(enabled: boolean) {
  active = enabled;
  observe?.configure({
    dispatchingEnabled: enabled,
    errorHandlingEnabled: enabled,
    networkTraces: false,
    environment: Constants.expoConfig?.extra?.appVariant ?? "production",
  });
}

export async function setCrashReportsEnabled(enabled: boolean) {
  const current = ++revision;
  if (!enabled || !crashReportingAvailable) {
    active = false;
    nativeObserve?.configure({ dispatchingEnabled: false });
    configure(false);
    return;
  }
  const sdk = await loadObserve();
  if (current !== revision) return;
  configure(false);
  await sdk.dispatchEvents();
  if (current === revision) configure(true);
}

export function reportCrash(error: unknown): void {
  if (active) observe?.reportError(error);
}

if (!crashReportingAvailable) {
  nativeObserve?.configure({ dispatchingEnabled: false });
} else {
  const initialRevision = revision;
  void import("../../persistence/imperative")
    .then(({ loadPreferences }) => loadPreferences())
    .then(async (preferences) => {
      if (initialRevision !== revision) return;
      if (preferences.crashReportsEnabled !== true) {
        await setCrashReportsEnabled(false);
        return;
      }
      await loadObserve();
      if (initialRevision === revision) configure(true);
    })
    .catch(() => {
      if (initialRevision === revision) void setCrashReportsEnabled(false);
    });
}

if (!__DEV__) {
  const hermes:
    | {
        enablePromiseRejectionTracker?: (options: {
          allRejections: boolean;
          onUnhandled: (id: number, rejection: unknown) => void;
        }) => void;
      }
    | undefined = Reflect.get(globalThis, "HermesInternal");
  hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, rejection) => reportCrash(rejection),
  });
}
