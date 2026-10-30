import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("expo", () => ({ requireOptionalNativeModule: () => null }));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  Platform: { OS: "ios" },
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));
vi.mock("expo-device", () => ({
  deviceName: "Test device",
  modelName: "Test model",
  osVersion: "27.0",
  deviceType: 1,
  DeviceType: { PHONE: 1, TABLET: 2 },
}));
vi.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: true, type: "WIFI" }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "test-id",
  getRandomBytes: (size: number) => new Uint8Array(size),
}));

afterEach(() => vi.unstubAllGlobals());

it("initializes the connection runtime before shell commands read it", async () => {
  vi.stubGlobal("__DEV__", false);
  const { connectionAtomRuntime } = await import("./runtime");
  const { shellEnvironment, environmentShell } = await import("../state/shell");
  expect(typeof connectionAtomRuntime.atom).toBe("function");
  expect(shellEnvironment).toBeDefined();
  expect(environmentShell).toBeDefined();
});

it("loads the App entry services before consuming the connection runtime", async () => {
  vi.resetModules();
  vi.stubGlobal("__DEV__", false);
  const uploads = await import("../state/composer-attachment-uploads");
  const outbox = await import("../state/threadOutboxDelivery");
  const { connectionAtomRuntime } = await import("./runtime");
  expect(typeof uploads.installComposerAttachmentUploads).toBe("function");
  expect(typeof outbox.installThreadOutboxDelivery).toBe("function");
  expect(typeof connectionAtomRuntime.atom).toBe("function");
});
