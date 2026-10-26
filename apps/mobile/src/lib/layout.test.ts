import { describe, expect, it } from "vite-plus/test";

import {
  alignListPaneToHinge,
  deriveLayout,
  deriveThreadFeedInitialContentInset,
  deriveThreadWorkLogSizing,
  deriveWorkspacePaneLayout,
  isPrimarySidebarPinned,
} from "./layout";

describe("thread work-log text sizing", () => {
  it.each([
    { baseFontSize: 16, fontScale: 1.25, estimatedRowHeight: 28 },
    { baseFontSize: 22, fontScale: 2, estimatedRowHeight: 52 },
  ])(
    "measures accessibility text instead of locking it to the estimate: %j",
    ({ estimatedRowHeight, ...settings }) => {
      expect(deriveThreadWorkLogSizing(settings)).toMatchObject({
        estimatedRowHeight,
        fixedRowHeight: undefined,
      });
    },
  );

  it("invalidates native text measurements even when the minimum row height is unchanged", () => {
    const original = deriveThreadWorkLogSizing({ baseFontSize: 16, fontScale: 1 });
    for (const settings of [
      { baseFontSize: 16, fontScale: 1.1 },
      { baseFontSize: 17, fontScale: 1 },
    ]) {
      const resized = deriveThreadWorkLogSizing(settings);
      expect(resized.estimatedRowHeight).toBe(original.estimatedRowHeight);
      expect(resized.textSizeKey).not.toBe(original.textSizeKey);
    }
  });
});

describe("deriveThreadFeedInitialContentInset", () => {
  it("does not double native iOS insets", () => {
    expect(
      deriveThreadFeedInitialContentInset({
        platform: "ios",
        usesNativeAutomaticInsets: true,
        bottomContentInset: 174,
      }),
    ).toBeUndefined();
  });
});

describe("isPrimarySidebarPinned", () => {
  it("keeps compact native roots pinned so search cannot hide the sidebar for a later split", () => {
    expect(
      isPrimarySidebarPinned({ pathname: "/", nativeWorkspace: true, usesSplitView: false }),
    ).toBe(true);
  });
});

describe("deriveWorkspacePaneLayout", () => {
  it("keeps the auxiliary pane out of a standard iPad detail column", () => {
    const layout = deriveLayout({ width: 1_194, height: 834 });

    expect(
      deriveWorkspacePaneLayout({
        layout,
        viewportWidth: 1_194,
        primarySidebarPreferredVisible: true,
        auxiliaryPanePreferredVisible: true,
      }),
    ).toEqual({
      primarySidebarVisible: true,
      primarySidebarWhenExpanded: true,
      primarySidebarSuppressedByAuxiliary: false,
      contentPaneWidth: 814,
      supportsAuxiliaryPane: false,
      auxiliaryPaneVisible: false,
      auxiliaryPaneWidth: null,
    });
  });

  it("offers an auxiliary pane when maximizing a standard iPad landscape window", () => {
    const layout = deriveLayout({ width: 1_194, height: 834 });

    expect(
      deriveWorkspacePaneLayout({
        layout,
        viewportWidth: 1_194,
        primarySidebarPreferredVisible: false,
        auxiliaryPanePreferredVisible: true,
      }),
    ).toEqual({
      primarySidebarVisible: false,
      primarySidebarWhenExpanded: false,
      primarySidebarSuppressedByAuxiliary: false,
      contentPaneWidth: 1_194,
      supportsAuxiliaryPane: true,
      auxiliaryPaneVisible: true,
      auxiliaryPaneWidth: 320,
    });
  });

  it("prioritizes a trailing file inspector over the thread sidebar at medium widths", () => {
    const layout = deriveLayout({ width: 1_024, height: 1_366 });

    expect(
      deriveWorkspacePaneLayout({
        layout,
        viewportWidth: 1_024,
        primarySidebarPreferredVisible: true,
        auxiliaryPanePreferredVisible: true,
        auxiliaryPaneRole: "inspector",
      }),
    ).toEqual({
      primarySidebarVisible: false,
      primarySidebarWhenExpanded: true,
      primarySidebarSuppressedByAuxiliary: true,
      contentPaneWidth: 1_024,
      supportsAuxiliaryPane: true,
      auxiliaryPaneVisible: true,
      auxiliaryPaneWidth: 260,
    });
  });

  it("keeps threads, content, and the file inspector visible in a large landscape window", () => {
    const layout = deriveLayout({ width: 1_366, height: 1_024 });

    expect(
      deriveWorkspacePaneLayout({
        layout,
        viewportWidth: 1_366,
        primarySidebarPreferredVisible: true,
        auxiliaryPanePreferredVisible: true,
        auxiliaryPaneRole: "inspector",
      }),
    ).toEqual({
      primarySidebarVisible: true,
      primarySidebarWhenExpanded: true,
      primarySidebarSuppressedByAuxiliary: false,
      contentPaneWidth: 986,
      supportsAuxiliaryPane: true,
      auxiliaryPaneVisible: true,
      auxiliaryPaneWidth: 276,
    });
  });

  it("keeps an explicitly hidden thread sidebar hidden when the file inspector is visible", () => {
    const layout = deriveLayout({ width: 1_024, height: 1_366 });

    expect(
      deriveWorkspacePaneLayout({
        layout,
        viewportWidth: 1_024,
        primarySidebarPreferredVisible: false,
        auxiliaryPanePreferredVisible: true,
        auxiliaryPaneRole: "inspector",
      }),
    ).toMatchObject({
      primarySidebarVisible: false,
      primarySidebarSuppressedByAuxiliary: false,
      auxiliaryPaneVisible: true,
    });
  });
});

describe("alignListPaneToHinge", () => {
  const layout = deriveLayout({ width: 852, height: 880 });

  it("ends the list pane at a book-posture hinge", () => {
    expect(
      alignListPaneToHinge({ layout, hinge: { x: 426, width: 0 }, viewportWidth: 852 }),
    ).toMatchObject({ listPaneWidth: 426, listPaneGap: 0 });
  });

  it("keeps the default split when either side of the hinge would be too narrow", () => {
    const narrowList = { layout, hinge: { x: 250, width: 0 }, viewportWidth: 852 };
    const narrowDetail = { layout, hinge: { x: 600, width: 0 }, viewportWidth: 852 };
    expect(alignListPaneToHinge(narrowList)).toBe(layout);
    expect(alignListPaneToHinge(narrowDetail)).toBe(layout);
  });
});
