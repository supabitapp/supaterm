import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("does not label stable web builds", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "");

    const branding = await import("./branding");

    expect(branding.APP_STAGE_LABEL).toBeNull();
    expect(branding.APP_DISPLAY_NAME).toBe("Supaterm");
  });

  it("keeps development web builds identified without changing the title", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "");

    const branding = await import("./branding");

    expect(branding.APP_STAGE_LABEL).toBe("Dev");
    expect(branding.APP_DISPLAY_NAME).toBe("Supaterm");
  });

  it("preserves an absent desktop stage over the web build fallback", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "Supaterm",
            stageLabel: null,
            displayName: "Supaterm",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_STAGE_LABEL).toBeNull();
    expect(branding.APP_DISPLAY_NAME).toBe("Supaterm");
  });
});
