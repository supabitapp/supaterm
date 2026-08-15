import SupatermTerminalCore
import Testing

@testable import supaterm

struct PaneViewBindingsTests {
  @Test
  func bindingsMaintainOnePanePerView() {
    let firstPaneID = PaneID()
    let secondPaneID = PaneID()
    let firstView = BoundView()
    let secondView = BoundView()
    var bindings = PaneViewBindings<BoundView>()

    bindings.bind(firstView, to: firstPaneID)
    bindings.bind(secondView, to: secondPaneID)

    #expect(bindings[firstPaneID] === firstView)
    #expect(bindings[secondPaneID] === secondView)
    #expect(bindings.paneID(for: firstView) == firstPaneID)

    bindings.bind(firstView, to: secondPaneID)

    #expect(bindings[firstPaneID] == nil)
    #expect(bindings[secondPaneID] === firstView)
    #expect(bindings.paneID(for: secondView) == nil)
    #expect(bindings.paneIDs == [secondPaneID])
    let unboundView = bindings.unbind(secondPaneID)
    #expect(unboundView === firstView)
    #expect(bindings.paneIDs.isEmpty)
  }
}

private final class BoundView {}
