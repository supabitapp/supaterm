import CoreGraphics
import Testing

@testable import supaterm

struct BrowserChromeSplitMetricsTests {
  @Test
  func rawFractionClampsToContainerBounds() {
    #expect(BrowserChromeSplitMetrics.rawFraction(for: -120, totalWidth: 1_000) == 0)
    #expect(BrowserChromeSplitMetrics.rawFraction(for: 250, totalWidth: 1_000) == 0.25)
    #expect(BrowserChromeSplitMetrics.rawFraction(for: 1_200, totalWidth: 1_000) == 1)
  }

  @Test
  func clampedFractionRespectsSidebarBounds() {
    #expect(
      BrowserChromeSplitMetrics.clampedFraction(0.1, minFraction: 0.16, maxFraction: 0.30) == 0.16
    )
    #expect(
      BrowserChromeSplitMetrics.clampedFraction(0.22, minFraction: 0.16, maxFraction: 0.30) == 0.22
    )
    #expect(
      BrowserChromeSplitMetrics.clampedFraction(0.4, minFraction: 0.16, maxFraction: 0.30) == 0.30
    )
  }

  @Test
  func previewCollapseAndHandleTrackingUseRawDragFraction() {
    #expect(
      BrowserChromeSplitMetrics.isCollapsePreviewActive(dragFraction: 0.12, minFraction: 0.16)
    )
    #expect(
      !BrowserChromeSplitMetrics.isCollapsePreviewActive(dragFraction: 0.20, minFraction: 0.16)
    )
    #expect(
      BrowserChromeSplitMetrics.handleFraction(
        dragFraction: 0.08,
        committedFraction: 0.20,
        maxFraction: 0.30
      ) == 0.08
    )
    #expect(
      BrowserChromeSplitMetrics.handleFraction(
        dragFraction: 0.50,
        committedFraction: 0.20,
        maxFraction: 0.30
      ) == 0.30
    )
  }

  @Test
  func sidebarWidthAndHandleOffsetTrackFraction() {
    let width = BrowserChromeSplitMetrics.sidebarWidth(for: 1_200, fraction: 0.25)

    #expect(width == 300)
    #expect(BrowserChromeSplitMetrics.resizeHandleOffset(for: width) == 293)
  }
}
