import { describe, expect, it, vi } from "vite-plus/test";

const expoMocks = vi.hoisted(() => ({
  requireNativeView: vi.fn(),
}));

vi.mock("expo", () => ({
  requireNativeView: expoMocks.requireNativeView,
}));

describe("isPendingNativeViewRegistration", () => {
  it("recognizes registration races for the installed native view name", async () => {
    const { isPendingNativeViewRegistration } = await import("./nativeReviewDiffSurface");

    expect(
      isPendingNativeViewRegistration(
        new Error("Unable to find the 'SupatermReviewDiffSurface' view for this native tag"),
      ),
    ).toBe(true);
    expect(
      isPendingNativeViewRegistration(
        new Error("Unable to find the 'SupatermReviewDiffView' view for this native tag"),
      ),
    ).toBe(false);
    expect(
      isPendingNativeViewRegistration(
        new Error(
          "Unable to find the class expo.modules.supatermreviewdiff.SupatermReviewDiffView view with tag 1150",
        ),
      ),
    ).toBe(true);
  });
});
