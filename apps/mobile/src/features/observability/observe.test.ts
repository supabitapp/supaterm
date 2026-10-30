import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  endpoint: "https://crashes.example.test/observe",
  native: true,
  configureNative: vi.fn(),
  configure: vi.fn(),
  dispatchEvents: vi.fn<() => Promise<void>>(),
  reportError: vi.fn(),
  loadPreferences: vi.fn<() => Promise<{ crashReportsEnabled?: boolean }>>(),
}));
vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return {
        extra: { appVariant: "production", crashReporting: { endpointUrl: state.endpoint } },
      };
    },
  },
}));
vi.mock("expo", () => ({
  requireOptionalNativeModule: () => (state.native ? { configure: state.configureNative } : null),
}));
vi.mock("expo-observe", () => ({
  Observe: {
    configure: state.configure,
    dispatchEvents: state.dispatchEvents,
    reportError: state.reportError,
  },
}));
vi.mock("../../persistence/imperative", () => ({ loadPreferences: state.loadPreferences }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("__DEV__", true);
  state.native = true;
  state.endpoint = "https://crashes.example.test/observe";
  state.loadPreferences.mockResolvedValue({});
  state.dispatchEvents.mockResolvedValue();
});

describe("crash reporting opt-in", () => {
  it("starts disabled when no choice was saved", async () => {
    const reporting = await import("./observe");
    await vi.dynamicImportSettled();
    reporting.reportCrash(new Error("not opted in"));
    expect(state.configureNative).toHaveBeenCalledWith({ dispatchingEnabled: false });
    expect(state.reportError).not.toHaveBeenCalled();
    expect(state.configure).not.toHaveBeenCalledWith(
      expect.objectContaining({ dispatchingEnabled: true }),
    );
  });

  it("requires a configured receiver even with saved opt-in", async () => {
    state.endpoint = "";
    state.loadPreferences.mockResolvedValue({ crashReportsEnabled: true });
    const reporting = await import("./observe");
    await reporting.setCrashReportsEnabled(true);
    expect(reporting.crashReportingAvailable).toBe(false);
    expect(state.configureNative).toHaveBeenCalledWith({ dispatchingEnabled: false });
    expect(state.configure).not.toHaveBeenCalled();
  });

  it("restores saved opt-in without discarding the previous crash", async () => {
    state.loadPreferences.mockResolvedValue({ crashReportsEnabled: true });
    const reporting = await import("./observe");
    await vi.dynamicImportSettled();
    reporting.reportCrash(new Error("captured"));
    expect(state.configure).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchingEnabled: true }),
    );
    expect(state.dispatchEvents).not.toHaveBeenCalled();
    expect(state.reportError).toHaveBeenCalledOnce();
  });

  it("does not complete a delayed enable after the user opts out", async () => {
    const reporting = await import("./observe");
    await vi.dynamicImportSettled();
    const flush = Promise.withResolvers<void>();
    state.dispatchEvents.mockReturnValueOnce(flush.promise);
    const enable = reporting.setCrashReportsEnabled(true);
    await vi.dynamicImportSettled();
    await reporting.setCrashReportsEnabled(false);
    flush.resolve();
    await enable;
    reporting.reportCrash(new Error("opted out"));
    expect(state.reportError).not.toHaveBeenCalled();
    expect(state.configure).not.toHaveBeenCalledWith(
      expect.objectContaining({ dispatchingEnabled: true }),
    );
  });
});
