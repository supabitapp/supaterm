import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const microphone = vi.hoisted(() => ({
  status: "not-determined" as string,
  ask: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("electron", () => ({
  systemPreferences: {
    getMediaAccessStatus: () => microphone.status,
    askForMediaAccess: () => microphone.ask(),
  },
}));

import {
  isAppOrigin,
  isMainWindowPermissionCheckAllowed,
  requestSystemMicrophoneAccess,
  resolveMainWindowMediaRequest,
} from "./MainWindowPermissions.ts";

const APP_URL = "supaterm://app/";

const decide = (overrides: Partial<Parameters<typeof resolveMainWindowMediaRequest>[0]> = {}) =>
  resolveMainWindowMediaRequest({
    requesterIsMain: true,
    requestingOrigin: "supaterm://app/",
    appUrl: APP_URL,
    mediaTypes: ["audio"],
    platform: "darwin",
    microphoneStatus: () => "granted",
    ...overrides,
  });

describe("isAppOrigin", () => {
  it("matches the app's scheme and host only", () => {
    expect(isAppOrigin("supaterm://app", APP_URL)).toBe(true);
    expect(isAppOrigin("supaterm://app/threads/1", APP_URL)).toBe(true);
    expect(isAppOrigin("supaterm://application/", APP_URL)).toBe(false);
    expect(isAppOrigin("supaterm-dev://app/", APP_URL)).toBe(false);
    expect(isAppOrigin("file:///etc/passwd", APP_URL)).toBe(false);
    expect(isAppOrigin("https://example.com/", APP_URL)).toBe(false);
    expect(isAppOrigin("null", APP_URL)).toBe(false);
    expect(isAppOrigin(undefined, APP_URL)).toBe(false);
  });

  it("includes the port for http origins", () => {
    expect(isAppOrigin("http://localhost:5173/x", "http://localhost:5173/")).toBe(true);
    expect(isAppOrigin("http://localhost:5174/x", "http://localhost:5173/")).toBe(false);
  });
});

describe("resolveMainWindowMediaRequest", () => {
  it("denies media to other webContents and other origins", () => {
    expect(decide({ requesterIsMain: false })).toBe("deny");
    expect(decide({ requestingOrigin: "https://example.com/" })).toBe("deny");
    expect(decide({ requestingOrigin: undefined })).toBe("deny");
  });

  it("denies camera capture even alongside audio", () => {
    expect(decide({ mediaTypes: ["video"] })).toBe("deny");
    expect(decide({ mediaTypes: ["audio", "video"] })).toBe("deny");
  });

  it("follows the macOS microphone status", () => {
    expect(decide({ microphoneStatus: () => "granted" })).toBe("allow");
    expect(decide({ microphoneStatus: () => "not-determined" })).toBe("ask");
    expect(decide({ microphoneStatus: () => "denied" })).toBe("deny");
    expect(decide({ microphoneStatus: () => "restricted" })).toBe("deny");
  });

  it("allows the microphone off macOS without consulting system status", () => {
    const microphoneStatus = vi.fn(() => "denied" as const);
    expect(decide({ platform: "win32", microphoneStatus })).toBe("allow");
    expect(decide({ platform: "linux", microphoneStatus })).toBe("allow");
    expect(microphoneStatus).not.toHaveBeenCalled();
  });

  it("allows requests without device media types from the app", () => {
    expect(decide({ mediaTypes: [], microphoneStatus: () => "denied" })).toBe("allow");
    expect(decide({ mediaTypes: [], requesterIsMain: false })).toBe("deny");
  });
});

describe("isMainWindowPermissionCheckAllowed", () => {
  const check = (overrides: Partial<Parameters<typeof isMainWindowPermissionCheckAllowed>[0]>) =>
    isMainWindowPermissionCheckAllowed({
      permission: "media",
      requesterIsMain: true,
      requestingOrigin: "supaterm://app/",
      mediaType: "audio",
      appUrl: APP_URL,
      ...overrides,
    });

  it("keeps Electron's defaults outside media", () => {
    expect(check({ permission: "notifications", requesterIsMain: false })).toBe(true);
    expect(check({ permission: "deprecated-sync-clipboard-read" })).toBe(false);
  });

  it("allows microphone checks only from the main window's app origin", () => {
    expect(check({})).toBe(true);
    expect(check({ mediaType: "video" })).toBe(false);
    expect(check({ requesterIsMain: false })).toBe(false);
    expect(check({ requestingOrigin: "https://example.com/" })).toBe(false);
  });
});

describe("requestSystemMicrophoneAccess", () => {
  beforeEach(() => {
    microphone.status = "not-determined";
    microphone.ask.mockReset();
  });

  it("reports access without prompting off macOS", async () => {
    microphone.status = "denied";
    await expect(requestSystemMicrophoneAccess("win32")).resolves.toEqual({
      granted: true,
      canAskAgain: true,
    });
    expect(microphone.ask).not.toHaveBeenCalled();
  });

  it("returns a settled status without prompting", async () => {
    microphone.status = "granted";
    await expect(requestSystemMicrophoneAccess("darwin")).resolves.toEqual({
      granted: true,
      canAskAgain: true,
    });
    microphone.status = "denied";
    await expect(requestSystemMicrophoneAccess("darwin")).resolves.toEqual({
      granted: false,
      canAskAgain: false,
    });
    microphone.status = "restricted";
    await expect(requestSystemMicrophoneAccess("darwin")).resolves.toEqual({
      granted: false,
      canAskAgain: false,
    });
    expect(microphone.ask).not.toHaveBeenCalled();
  });

  it("prompts once when undetermined", async () => {
    microphone.ask.mockImplementation(async () => {
      microphone.status = "granted";
      return true;
    });
    await expect(requestSystemMicrophoneAccess("darwin")).resolves.toEqual({
      granted: true,
      canAskAgain: true,
    });
    expect(microphone.ask).toHaveBeenCalledOnce();
  });

  it("cannot ask again after the user declines", async () => {
    microphone.ask.mockImplementation(async () => {
      microphone.status = "denied";
      return false;
    });
    await expect(requestSystemMicrophoneAccess("darwin")).resolves.toEqual({
      granted: false,
      canAskAgain: false,
    });
  });

  it("can ask again when the prompt fails before the user answers", async () => {
    microphone.ask.mockRejectedValue(new Error("unavailable"));
    await expect(requestSystemMicrophoneAccess("darwin")).resolves.toEqual({
      granted: false,
      canAskAgain: true,
    });
  });
});
