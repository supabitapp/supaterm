import SwiftUI
import Testing

@testable import supaterm

struct TerminalSplitTreeViewTests {
  @Test
  func notificationPulsePatternMatchesDismissPulseShape() {
    #expect(TerminalNotificationPulsePattern.initialOpacity == 1)
    #expect(TerminalNotificationPulsePattern.initialScale == 1)
    #expect(TerminalNotificationPulsePattern.targetOpacity == 0)
    #expect(TerminalNotificationPulsePattern.targetScale == 1.02)
    #expect(TerminalNotificationPulsePattern.duration == 0.28)
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
}
