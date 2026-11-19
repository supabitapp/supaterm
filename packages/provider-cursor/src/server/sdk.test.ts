import { describe, expect, it } from "vite-plus/test";

import { makeCursorSdkLoaders } from "./sdk.ts";

function fixture() {
  class SdkError extends Error {}
  const sdk = {
    CursorSdkError: SdkError,
    AuthenticationError: SdkError,
    ConfigurationError: SdkError,
  };
  const sqlite = { SqliteLocalAgentStore: {} };
  const calls: Array<string> = [];
  const failures: Array<Error> = [];
  const requireSdk = (id: string) => {
    calls.push(id);
    const failure = failures.shift();
    if (failure) throw failure;
    return id === "@cursor/sdk" ? sdk : sqlite;
  };
  return { sdk, sqlite, calls, failures, loaders: makeCursorSdkLoaders(requireSdk) };
}

describe("Cursor disk modules", () => {
  it("loads on demand, shares exports across callers, and leaves SQLite unloaded", async () => {
    const fake = fixture();
    const sdk = fake.loaders;
    expect(fake.calls).toEqual([]);
    expect(sdk.isCursorSdkError(new Error("unloaded"), "CursorSdkError")).toBe(false);
    const modules = await Promise.all([
      Promise.resolve().then(sdk.loadCursorSdk),
      Promise.resolve().then(sdk.loadCursorSdk),
    ]);
    expect(modules).toEqual([fake.sdk, fake.sdk]);
    expect(modules[0]).toBe(modules[1]);
    expect(fake.calls).toEqual(["@cursor/sdk"]);
    expect(sdk.isCursorSdkError(new fake.sdk.CursorSdkError("same class"), "CursorSdkError")).toBe(
      true,
    );
    expect(sdk.loadCursorSqlite()).toBe(fake.sqlite);
    expect(sdk.loadCursorSqlite()).toBe(fake.sqlite);
    expect(fake.calls).toEqual(["@cursor/sdk", "@cursor/sdk/sqlite"]);
  });

  it("surfaces failed loads and permits a later retry without caching partial exports", () => {
    const fake = fixture();
    const sdk = fake.loaders;
    const failure = new Error("missing native chunk");
    fake.failures.push(failure);
    expect(sdk.loadCursorSdk).toThrow(failure);
    expect(sdk.isCursorSdkError(failure, "CursorSdkError")).toBe(false);
    expect(sdk.loadCursorSdk()).toBe(fake.sdk);
    fake.failures.push(failure);
    expect(sdk.loadCursorSqlite).toThrow(failure);
    expect(sdk.loadCursorSqlite()).toBe(fake.sqlite);
    expect(fake.calls).toHaveLength(4);
  });
});
