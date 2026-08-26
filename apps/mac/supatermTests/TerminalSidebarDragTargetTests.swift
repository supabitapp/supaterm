import Testing

@testable import supaterm

struct TerminalSidebarDragTargetTests {
  @Test
  func missRetainsTheCurrentTargetAndRejectsTheDrop() {
    let current = plan(path: path(1), index: 1)
    var state = TerminalSidebarDragTargetState.accepted(current)

    let decision = state.transition(.miss)

    #expect(state == .retained(current))
    #expect(decision.target == .retain)
    #expect(decision.haptic == .none)
    #expect(!state.acceptsDrop)
  }

  @Test
  func rejectedHitRetainsTheCurrentTargetAndRejectsTheDrop() {
    let current = plan(path: path(1), index: 1)
    var state = TerminalSidebarDragTargetState.accepted(current)

    let decision = state.transition(.rejected)

    #expect(state == .retained(current))
    #expect(decision.target == .retain)
    #expect(decision.haptic == .none)
    #expect(!state.acceptsDrop)
  }

  @Test
  func sameAcceptedPlanChangesOnlyCurrentDropValidity() {
    let current = plan(path: path(1), index: 1)
    var state = TerminalSidebarDragTargetState.retained(current)

    let decision = state.transition(.accepted(current))

    #expect(state == .accepted(current))
    #expect(decision.target == .unchanged)
    #expect(decision.haptic == .none)
    #expect(state.acceptsDrop)
  }

  @Test
  func changedAcceptedPlanUpdatesTheTargetAndHapticPath() {
    let current = plan(path: path(1), index: 1)
    let next = plan(path: path(2), index: 2)
    var state = TerminalSidebarDragTargetState.accepted(current)

    let decision = state.transition(.accepted(next))

    #expect(state == .accepted(next))
    #expect(decision.target == .update(next))
    #expect(decision.haptic == .update(next.path))
    #expect(state.acceptsDrop)
  }

  @Test
  func changedAcceptedPlanOnTheSamePathKeepsTheHapticTarget() {
    let sharedPath = path(1)
    let current = plan(path: sharedPath, index: 1)
    let next = plan(path: sharedPath, index: 2)
    var state = TerminalSidebarDragTargetState.accepted(current)

    let decision = state.transition(.accepted(next))

    #expect(state == .accepted(next))
    #expect(decision.target == .update(next))
    #expect(decision.haptic == .none)
    #expect(state.acceptsDrop)
  }

  @Test
  func explicitEndClearsTheTargetAndResetsHaptics() {
    let current = plan(path: path(1), index: 1)
    var state = TerminalSidebarDragTargetState.accepted(current)

    let decision = state.transition(.ended)

    #expect(state == .none)
    #expect(decision.target == .clear)
    #expect(decision.haptic == .reset)
    #expect(!state.acceptsDrop)
  }

  private func path(_ index: Int) -> TerminalSidebarSemanticPath {
    .rootBoundary(lane: .regular, index: index)
  }

  private func plan(
    path: TerminalSidebarSemanticPath,
    index: Int
  ) -> TerminalSidebarDropPlan {
    TerminalSidebarDropPlan(
      path: path,
      destination: .root(isPinned: false, index: index),
      placeholder: .beforeFooter
    )
  }
}
