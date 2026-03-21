import CoreGraphics
import Testing

@testable import supaterm

struct TerminalSplitMetricsTests {
  @Test
  func rawFractionClampsToContainerBounds() {
    #expect(TerminalSplitMetrics.rawFraction(for: -120, totalWidth: 1_000) == 0)
    #expect(TerminalSplitMetrics.rawFraction(for: 250, totalWidth: 1_000) == 0.25)
    #expect(TerminalSplitMetrics.rawFraction(for: 1_200, totalWidth: 1_000) == 1)
  }

  @Test
  func clampedFractionRespectsSidebarBounds() {
    #expect(
      TerminalSplitMetrics.clampedFraction(0.1, minFraction: 0.16, maxFraction: 0.30) == 0.16
    )
    #expect(
      TerminalSplitMetrics.clampedFraction(0.22, minFraction: 0.16, maxFraction: 0.30) == 0.22
    )
    #expect(
      TerminalSplitMetrics.clampedFraction(0.4, minFraction: 0.16, maxFraction: 0.30) == 0.30
    )
  }

  @Test
  func previewCollapseAndHandleTrackingUseRawDragFraction() {
    #expect(
      TerminalSplitMetrics.isCollapsePreviewActive(dragFraction: 0.12, minFraction: 0.16)
    )
    #expect(
      !TerminalSplitMetrics.isCollapsePreviewActive(dragFraction: 0.20, minFraction: 0.16)
    )
    #expect(
      TerminalSplitMetrics.handleFraction(
        dragFraction: 0.08,
        committedFraction: 0.20,
        maxFraction: 0.30
      ) == 0.08
    )
    #expect(
      TerminalSplitMetrics.handleFraction(
        dragFraction: 0.50,
        committedFraction: 0.20,
        maxFraction: 0.30
      ) == 0.30
    )
  }

  @Test
  func sidebarWidthAndHandleOffsetTrackFraction() {
    let width = TerminalSplitMetrics.sidebarWidth(for: 1_200, fraction: 0.25)
    let handleOffset = TerminalSplitMetrics.resizeHandleOffset(for: width)

    #expect(width == 300)
    #expect(handleOffset + (TerminalSplitMetrics.resizeHandleWidth / 2) == width)
  }
}
