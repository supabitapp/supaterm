import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { tryOpenExternalUrl } from "./openExternalUrl";

const linking = vi.hoisted(() => ({
  openURL: vi.fn<(url: string) => void>(),
  failure: null as Error | null,
}));

vi.mock("react-native", () => ({
  Linking: {
    openURL: async (url: string) => {
      linking.openURL(url);
      if (linking.failure) throw linking.failure;
    },
  },
}));

const openURL = linking.openURL;

beforeEach(() => {
  vi.clearAllMocks();
  linking.failure = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tryOpenExternalUrl", () => {
  it("keeps provider sign-in URLs unchanged and out of failure logs", async () => {
    const url =
      "https://accounts.google.com/o/oauth2/v2/auth?state=private-state&code_challenge=private-challenge&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2F";
    linking.failure = new Error(`Cannot open ${url}`);
    const consoleError = vi.spyOn(console, "error");

    await expect(tryOpenExternalUrl(url, "provider-auth")).resolves.toBe(false);

    expect(openURL).toHaveBeenCalledWith(url);
    const diagnostics = JSON.stringify(consoleError.mock.calls);
    expect(diagnostics).toContain("accounts.google.com");
    expect(diagnostics).not.toContain("private-state");
    expect(diagnostics).not.toContain("private-challenge");
    expect(diagnostics).not.toContain("43123");
  });
});
