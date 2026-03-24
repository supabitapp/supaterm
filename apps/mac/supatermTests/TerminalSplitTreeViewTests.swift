import SwiftUI
import Testing

@testable import supaterm

struct TerminalSplitTreeViewTests {
  @Test
  func notificationFlashPatternMatchesDoublePulseShape() {
    #expect(TerminalNotificationFlashPattern.values == [0, 1, 0, 1, 0])
    #expect(TerminalNotificationFlashPattern.keyTimes == [0, 0.25, 0.5, 0.75, 1])
    #expect(TerminalNotificationFlashPattern.duration == 0.9)
    #expect(
      TerminalNotificationFlashPattern.curves
        == [.easeOut, .easeIn, .easeOut, .easeIn]
    )
  }

  @Test
  func notificationFlashPatternSegmentsCoverFullDoublePulseTimeline() {
    let segments = TerminalNotificationFlashPattern.segments

    #expect(segments.count == 4)
    #expect(segments[0] == .init(delay: 0, duration: 0.225, targetOpacity: 1, curve: .easeOut))
    #expect(segments[1] == .init(delay: 0.225, duration: 0.225, targetOpacity: 0, curve: .easeIn))
    #expect(segments[2] == .init(delay: 0.45, duration: 0.225, targetOpacity: 1, curve: .easeOut))
    #expect(segments[3] == .init(delay: 0.675, duration: 0.225, targetOpacity: 0, curve: .easeIn))
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
}
