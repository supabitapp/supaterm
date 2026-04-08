import SwiftUI
import Testing

@testable import supaterm

struct TerminalSplitTreeViewTests {
  final class MockSurfaceView: NSView, Identifiable {
    let id = UUID()
  }

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
    let overlayIsVisibleAfterResize =
      TerminalSplitTreeView.resizeOverlayIsHidden(
        ready: true,
        lastSize: .init(width: 100, height: 100),
        currentSize: .init(width: 120, height: 100)
      ) == false

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
    if overlayIsVisibleAfterResize == false {
      Issue.record("Expected resize overlay to become visible after the first resize")
    }
    #expect(
      TerminalSplitTreeView.resizeOverlayIsHidden(
        ready: true,
        lastSize: .init(width: 120, height: 100),
        currentSize: .init(width: 120, height: 100)
      )
    )
  }

  @Test
  func dividerDescriptorsFollowSplitTreeOrder() {
    let views = (0..<3).map { _ in MockSurfaceView() }
    let tree = SplitTree(
      root: .split(
        .init(
          direction: .horizontal,
          ratio: 0.5,
          left: .leaf(view: views[0]),
          right: .split(
            .init(
              direction: .vertical,
              ratio: 0.25,
              left: .leaf(view: views[1]),
              right: .leaf(view: views[2])
            ))
        )),
      zoomed: nil
    )

    let descriptors = TerminalSplitAccessibility.dividerDescriptors(
      for: tree.root,
      in: CGRect(x: 0, y: 0, width: 200, height: 100)
    )

    #expect(descriptors.map(\.path) == [.root, .init(components: [.right])])
    #expect(descriptors.map(\.accessibilityLabel) == ["Horizontal split divider", "Vertical split divider"])
    #expect(
      descriptors.map(\.accessibilityHelp) == [
        "Drag to resize the left and right panes",
        "Drag to resize the top and bottom panes",
      ])
    #expect(descriptors[0].frameInParentSpace == CGRect(x: 96.5, y: 0, width: 7, height: 100))
    #expect(descriptors[1].frameInParentSpace == CGRect(x: 100, y: 21.5, width: 100, height: 7))
  }

  @Test
  func dividerAdjustmentUsesTenPointStep() {
    let descriptor = TerminalSplitDividerAXDescriptor(
      path: .root,
      direction: .horizontal,
      ratio: 0.5,
      splitBounds: CGRect(x: 0, y: 0, width: 200, height: 100),
      frameInParentSpace: .zero
    )

    #expect(descriptor.adjustedRatio(incrementing: true) == 0.55)
    #expect(descriptor.adjustedRatio(incrementing: false) == 0.45)
  }

  @Test
  func dividerAdjustmentClampsToMinimumPaneSize() {
    let descriptor = TerminalSplitDividerAXDescriptor(
      path: .root,
      direction: .horizontal,
      ratio: 0.12,
      splitBounds: CGRect(x: 0, y: 0, width: 80, height: 100),
      frameInParentSpace: .zero
    )

    #expect(descriptor.adjustedRatio(incrementing: false) == 0.125)
    #expect(descriptor.adjustedRatio(incrementing: true) == 0.245)
  }
}
