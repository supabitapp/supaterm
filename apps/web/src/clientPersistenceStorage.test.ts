import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createLocalStorageStub(readFailures: Array<Error>): Storage;
function createLocalStorageStub(readFailures: Array<Error>) {
  const store = new Map<string, string>();
  return {
    getItem: (key) => {
      const failure = readFailures.shift();
      if (failure) throw failure;
      return store.get(key) ?? null;
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } satisfies Storage;
}

function getTestWindow(readFailures: Array<Error> = []) {
  const localStorage = createLocalStorageStub(readFailures);
  const testWindow = {
    localStorage,
  } as Window & typeof globalThis;
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return testWindow;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clientPersistenceStorage", () => {
  it.each(["not-json", '{"wordWrap":"invalid"}'])(
    "does not treat invalid saved settings as absent: %s",
    async (value) => {
      const testWindow = getTestWindow();
      testWindow.localStorage.setItem("supaterm:client-settings:v1", value);
      const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

      expect(() => readBrowserClientSettings()).toThrow(
        expect.objectContaining({
          _tag: "LocalStorageOperationError",
          operation: "decode",
          storageKey: "supaterm:client-settings:v1",
        }),
      );
      expect(testWindow.localStorage.getItem("supaterm:client-settings:v1")).toBe(value);
    },
  );

  it("preserves saved settings across a transient read failure", async () => {
    const readFailures: Array<Error> = [];
    const testWindow = getTestWindow(readFailures);
    const settings = { ...DEFAULT_CLIENT_SETTINGS, timestampFormat: "12-hour" as const };
    testWindow.localStorage.setItem("supaterm:client-settings:v1", JSON.stringify(settings));
    const write = vi.spyOn(testWindow.localStorage, "setItem");
    const failure = new Error("storage unavailable");
    readFailures.push(failure);
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

    expect(() => readBrowserClientSettings()).toThrow(
      expect.objectContaining({
        _tag: "LocalStorageOperationError",
        operation: "read",
        storageKey: "supaterm:client-settings:v1",
        cause: failure,
      }),
    );
    expect(readBrowserClientSettings()).toEqual(settings);
    expect(write).not.toHaveBeenCalled();
  });
});
