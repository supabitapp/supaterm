import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-clipboard", () => ({}));
vi.mock("expo-haptics", () => ({}));

import {
  copyTextWithHaptic,
  tryCopyTextWithHaptic,
  type CopyTextPlatform,
} from "./copyTextWithHaptic";

function fakePlatform(
  results: {
    readonly clipboard?: () => Promise<void>;
    readonly haptic?: () => Promise<void>;
  } = {},
) {
  const platform = {
    setString: (_value: string) => results.clipboard?.() ?? new Promise<void>(() => undefined),
    lightImpact: () => results.haptic?.() ?? Promise.resolve(),
    selection: () => Promise.resolve(),
    reportError: (_message: string, _details: object) => {},
  } satisfies CopyTextPlatform;
  return {
    platform,
    setString: vi.spyOn(platform, "setString"),
    lightImpact: vi.spyOn(platform, "lightImpact"),
    selection: vi.spyOn(platform, "selection"),
    reportError: vi.spyOn(platform, "reportError"),
  };
}

describe("copyTextWithHaptic", () => {
  it("triggers haptic feedback without waiting for the clipboard promise", () => {
    const native = fakePlatform();
    copyTextWithHaptic("trace-123", {}, native.platform);

    expect(native.setString).toHaveBeenCalledWith("trace-123");
    expect(native.lightImpact).toHaveBeenCalledOnce();
  });

  it("preserves selection feedback for thread work rows", () => {
    const native = fakePlatform();
    copyTextWithHaptic(
      "work output",
      {
        target: "thread-work-row",
        feedback: "selection",
      },
      native.platform,
    );

    expect(native.setString).toHaveBeenCalledWith("work output");
    expect(native.selection).toHaveBeenCalledOnce();
    expect(native.lightImpact).not.toHaveBeenCalled();
  });

  it("reports whether the clipboard write succeeded", async () => {
    const native = fakePlatform({ clipboard: async () => {} });

    await expect(tryCopyTextWithHaptic("thread-123", {}, native.platform)).resolves.toBe(true);
  });

  it("returns false when the clipboard write fails", async () => {
    const native = fakePlatform({
      clipboard: () => Promise.reject(new Error("native clipboard failure")),
    });

    await expect(tryCopyTextWithHaptic("thread-123", {}, native.platform)).resolves.toBe(false);
  });

  it("reports structured failures without including clipboard contents", async () => {
    const content = "https://accounts.google.com/auth?state=private-state&code=private-code";
    const clipboardCause = new Error(`Cannot copy ${content}`);
    const hapticCause = new Error(`Native failure for ${content}`);
    const native = fakePlatform({
      clipboard: () => Promise.reject(clipboardCause),
      haptic: () => Promise.reject(hapticCause),
    });

    await tryCopyTextWithHaptic(content, { target: "provider-sign-in-link" }, native.platform);

    expect(native.reportError).toHaveBeenCalledWith(
      "Failed to copy provider-sign-in-link to the clipboard.",
      expect.objectContaining({
        _tag: "CopyTextClipboardWriteError",
        target: "provider-sign-in-link",
      }),
    );
    expect(native.reportError).toHaveBeenCalledWith(
      "Failed to trigger light-impact haptic feedback after copying provider-sign-in-link.",
      expect.objectContaining({ _tag: "CopyTextHapticFeedbackError", feedback: "light-impact" }),
    );
    const diagnostics = JSON.stringify(native.reportError.mock.calls);
    expect(diagnostics).not.toContain("private-state");
    expect(diagnostics).not.toContain("private-code");
    expect(diagnostics).not.toContain("cause");
  });
});
