import SwiftUI
import Testing

@testable import supaterm

struct TerminalSplitTreeViewTests {
  @Test
  func notificationPulsePatternMatchesThreeFixedSizePulses() {
    #expect(TerminalNotificationPulsePattern.initialOpacity == 1)
    #expect(TerminalNotificationPulsePattern.lowOpacity == 0.32)
    #expect(TerminalNotificationPulsePattern.totalDuration == 1)
    #expect(
      TerminalNotificationPulsePattern.targetOpacities == [
        0.32,
        1,
        0.32,
        1,
        0.32,
        1,
        0,
      ]
    )
    #expect(TerminalNotificationPulsePattern.stepDuration == 1.0 / 7.0)
    #expect(TerminalNotificationPulsePattern.segments.count == 7)
    #expect(
      TerminalNotificationPulsePattern.segments.map(\.targetOpacity) == TerminalNotificationPulsePattern.targetOpacities
    )
    #expect(TerminalNotificationPulsePattern.segments.map(\.duration) == Array(repeating: 1.0 / 7.0, count: 7))
    #expect(
      TerminalNotificationPulsePattern.segments.first == .init(delay: 0, duration: 1.0 / 7.0, targetOpacity: 0.32))
    #expect(
      TerminalNotificationPulsePattern.segments.last == .init(delay: 6.0 / 7.0, duration: 1.0 / 7.0, targetOpacity: 0))
  }

  @Test
  func notificationPulseTriggersOnlyWhenAttentionDismisses() {
    #expect(!TerminalSplitTreeView.LeafView.shouldTriggerNotificationPulse(from: false, to: false))
    #expect(!TerminalSplitTreeView.LeafView.shouldTriggerNotificationPulse(from: false, to: true))
    #expect(!TerminalSplitTreeView.LeafView.shouldTriggerNotificationPulse(from: true, to: true))
    #expect(TerminalSplitTreeView.LeafView.shouldTriggerNotificationPulse(from: true, to: false))
  }

  @Test
  func horizontalSplitDropsInnerLeadingAndTrailingEdges() {
    let outerEdges: TerminalSplitTreeView.OuterEdges = .all

    #expect(
      outerEdges.child(.left, in: .horizontal)
        == [.top, .bottom, .leading]
    )
    #expect(
      outerEdges.child(.right, in: .horizontal)
        == [.top, .bottom, .trailing]
    )
  }

  @Test
  func verticalSplitDropsInnerTopAndBottomEdges() {
    let outerEdges: TerminalSplitTreeView.OuterEdges = .all

    #expect(
      outerEdges.child(.left, in: .vertical)
        == [.top, .leading, .trailing]
    )
    #expect(
      outerEdges.child(.right, in: .vertical)
        == [.bottom, .leading, .trailing]
    )
  }

  @Test
  func cornerRadiiKeepTopEdgeSquare() {
    let radii = TerminalSplitTreeView.OuterEdges([.top, .bottom, .leading])
      .cornerRadii(cornerRadius: 16)

    #expect(radii.topLeading == 0)
    #expect(radii.bottomLeading == 16)
    #expect(radii.topTrailing == 0)
    #expect(radii.bottomTrailing == 0)
  }

  @Test
  func dropZoneUsesUpForTopEdge() {
    let zone = TerminalSplitTreeView.DropZone.calculate(
      at: .init(x: 60, y: 4),
      in: .init(width: 120, height: 120)
    )

    #expect(zone == .up)
  }

  @Test
  func resizeOverlayGridSizeUsesBackingPixelsAndCellSize() {
    let gridSize = TerminalSplitTreeView.resizeOverlayGridSize(
      backingSize: .init(width: 1728, height: 980),
      cellSize: .init(width: 13, height: 20)
    )

    #expect(gridSize == .init(columns: 132, rows: 49))
  }

  @Test
  func resizeOverlayGridSizeRequiresValidMinimumGrid() {
    #expect(
      TerminalSplitTreeView.resizeOverlayGridSize(
        backingSize: .init(width: 40, height: 30),
        cellSize: .init(width: 10, height: 20)
      ) == nil
    )
    #expect(
      TerminalSplitTreeView.resizeOverlayGridSize(
        backingSize: .init(width: 400, height: 300),
        cellSize: .zero
      ) == nil
    )
  }

  @Test
  func resizeOverlayStaysHiddenUntilAfterFirstResize() {
    #expect(
      TerminalSplitTreeView.resizeOverlayIsHidden(
        ready: false,
        lastSize: nil,
        currentSize: .init(width: 100, height: 100)
      )
    )
    #expect(
      TerminalSplitTreeView.resizeOverlayIsHidden(
        ready: true,
        lastSize: nil,
        currentSize: .init(width: 100, height: 100)
      )
    )
    #expect(
      !TerminalSplitTreeView.resizeOverlayIsHidden(
        ready: true,
        lastSize: .init(width: 100, height: 100),
        currentSize: .init(width: 120, height: 100)
      )
    )
    #expect(
      TerminalSplitTreeView.resizeOverlayIsHidden(
        ready: true,
        lastSize: .init(width: 120, height: 100),
        currentSize: .init(width: 120, height: 100)
      )
    )
  }
}
