import SwiftUI
import Testing

@testable import supaterm

struct TerminalSplitTreeViewTests {
  @Test
  func notificationFlashPatternMatchesDismissBlinkShape() {
    #expect(TerminalNotificationFlashPattern.initialOpacity == 1)
    #expect(
      TerminalNotificationFlashPattern.segments == [
        .init(delay: 0, duration: 0.225, targetOpacity: 0, curve: .easeIn),
        .init(delay: 0.225, duration: 0.225, targetOpacity: 1, curve: .easeOut),
        .init(delay: 0.45, duration: 0.225, targetOpacity: 0, curve: .easeIn),
      ]
    )
  }

  @Test
  func notificationFlashTriggersOnlyWhenAttentionDismisses() {
    #expect(!TerminalSplitTreeView.LeafView.shouldTriggerNotificationFlash(from: false, to: false))
    #expect(!TerminalSplitTreeView.LeafView.shouldTriggerNotificationFlash(from: false, to: true))
    #expect(!TerminalSplitTreeView.LeafView.shouldTriggerNotificationFlash(from: true, to: true))
    #expect(TerminalSplitTreeView.LeafView.shouldTriggerNotificationFlash(from: true, to: false))
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
